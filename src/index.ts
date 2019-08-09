import { Router, Request,Response, NextFunction } from "express";
import express from "express";
import Redis from 'ioredis'
import multer from 'multer'
import fs, { ReadStream } from 'fs'
import bodyParser from 'body-parser'
import * as util from './util'
const unzip = require('unzip-stream')


export interface Version {
    major:number
    minor:number
    patch:number
}

export type DeployType='major' | 'minor' | 'patch'

interface SiteSetting<IDType>{
    name:string
    deployPath:string
    host:string[]
    protocol:string[],
    key:string
    route:string
}

type SaveCallback<T> = (
    params: {
        name:string
        zipFile:ReadStream, 
        type: DeployType,
        version:Version
    })=>Promise<T>

type RestoreCallback<A> = (
    params: {
    name?:string
    /**
     * 是否只返回最新版本
     */
    newest?:boolean
    /**
     * 是否只返回需部署版本
     */
    onlyCurrent?:boolean
    /**
     * 只返回指定的id的内容
     */
    id?:A
})=> Promise< { name:string, current:boolean , type:DeployType, version: Version,zipUrl:string, id:A }[] >

type ChangeCurrentDeployCallback<T> = (params: {
    id:T
})=>Promise< {name:string} >

interface ConstructorParam<IDType>{
    sites:SiteSetting<IDType>[],
    redisUrl?:string
    tmpPath:string
    saveCallback:SaveCallback<IDType>

    restoreCallback:RestoreCallback<IDType>

    changeCurrentDeployCallback:ChangeCurrentDeployCallback<IDType>

    resultCallback?: (err:any, msg:any) =>void
}

// interface DeploySetting<T> extends ConstructorParam<T>{
//     redisSub?:Redis.Redis
//     redisPub?:Redis.Redis
//     multer:multer.Instance
// }

const channel = 'deploy-site-channel'
export class DeploySite<IDType>{
    private redisSub?:Redis.Redis
    private redisPub?:Redis.Redis
    private multer:multer.Instance
    private saveCallback:SaveCallback<IDType>

    private restoreCallback:RestoreCallback<IDType>

    private changeCurrentDeployCallback:ChangeCurrentDeployCallback<IDType>
    private resultCallback: (err:any, msg:any) =>void

    private siteSettings:SiteSetting<IDType>[]  = []
    constructor(params:ConstructorParam<IDType>){
        this.siteSettings = params.sites
        this.multer = multer({dest:params.tmpPath})
        this.saveCallback = params.saveCallback
        this.restoreCallback = params.restoreCallback
        this.changeCurrentDeployCallback = params.changeCurrentDeployCallback
        this.resultCallback = params.resultCallback || function(x,y){}
        if(params.redisUrl){
            this.redisSub = new Redis(params.redisUrl,{maxRetriesPerRequest: null})
            this.redisPub = new Redis(params.redisUrl,{maxRetriesPerRequest: null})
            this.redisSub.subscribe(channel)
            this.redisSub.on('message', (channel, message)=>this.handleRedisMessage(message))
        }
    }
    async setDeploy(params:{id:IDType}):Promise<void> {
        let results = await this.restoreCallback({id:params.id})
        if(results.length<0){
            throw new Error('Can find deploy '+params.id)
        }
        let result = results[0]
        await this.changeCurrentDeployCallback({id:result.id})
        let name = result.name
        if(this.redisPub){
            this.redisPub.publish(channel,name)
        }else{
            this.deploy(name)
        }
    }

    /**
     * 根路由必须加载 bodyParser
     */
    routerUpload():Router{
        let router = Router()
        // router.use(bodyParser.json());
        // router.use(bodyParser.urlencoded({
        //     extended: false
        // }));
        this.siteSettings.forEach(e=>{
            let app = Router()
            // const host = e.host
            // const protocol = e.protocol
            // app.use((req: Request, res: Response, next: NextFunction)=>{
            //     if (host.includes(req.hostname) && protocol.includes(req.protocol)){
            //         next()
            //     }else{
            //         res.status(404)
            //         res.send()
            //     }
            // })
            
            app.post('/', this.multer.single('app'), async (req, res) => {
                if (!(req.file && req.file.path)) {
                    res.send('Invalid params')
                    this.resultCallback('Invalid params',null)
                    return
                }
                if (!req.body['type']) {
                    res.send('Missing type params')
                    this.resultCallback('Missing type params',null)
                    return
                }
                if (req.body['key']!=e.key) {
                    res.send('Invalid key:'+req.body['key'])
                    this.resultCallback('Invalid key:'+req.body['key'],null)
                    return
                }
                let type = req.body['type'] as DeployType
                let newest = await this.restoreCallback({
                    name:e.name,
                    newest:true
                })
                let version = (newest[0]&&newest[0].version )|| { major:1,patch:0,minor:0}
                version[type] = (version[type]||0) + 1
                if(type=='major'){
                    version.patch = 0
                    version.minor = 0
                }else if(type=='minor'){
                    version.patch = 0
                }
                let id = await this.saveCallback({
                    name:e.name,
                    zipFile:fs.createReadStream(req.file.path),
                    type:type,
                    version:version
                })
                await this.setDeploy({id})
                this.resultCallback(null,id)
                res.send()
            })
            router.use( e.route,app)
        })
        return router
    }

    routerHost():Router{
        let router = Router()
        // router.use(bodyParser.json());
        // router.use(bodyParser.urlencoded({
        //     extended: false
        // }));
        this.siteSettings.forEach(e=>{
            let app = Router()
            const host = e.host
            const protocol = e.protocol
            app.use('/static-'+e.key,express.static(e.deployPath))
            app.use((req: Request, res: Response, next: NextFunction)=>{
                if (host.includes(req.hostname) && protocol.includes(req.protocol)){
                    // next()
                    next(e.route +'/static-'+e.key)
                }else{
                    next()
                    // res.status(404)
                    // res.send()
                }
            })
            router.use(e.route,app)
        })
        return router
    }

    /**
     * 
     * @param name 指定部署的网站,空则全部部署
     */
    async deploy(name?:string){
        if(name){
            console.log('deploy '+name)
            let site = this.siteSettings.find(x=>x.name==name)
            if(!site){
                throw new Error('Can find site '+name)
            }
            let deploy = await this.restoreCallback({name,onlyCurrent:true})
            if(deploy.length==0){
                deploy = await this.restoreCallback({name,newest:true})
            }
            if(deploy.length==0){
                console.error('Can not find deploy :'+name)
                return
            }
            return this._deploy({
                path:site.deployPath,
                zipUrl:deploy[0].zipUrl
            })
        }else{
            for(let i=0;i<this.siteSettings.length;++i){
                await this.deploy(this.siteSettings[i].name)
            }
        }
    }

    private handleRedisMessage(name:string){
        this.deploy(name)
    }
    private async _deploy( params:{
        path:string
        zipUrl:string
    } ){
        let file = await util.tmpFileFromUrl(params.zipUrl)
        fs.createReadStream(file.path).pipe(unzip.Extract({ path: params.path }))
    }
}