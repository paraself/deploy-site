import { Router, Request,Response, NextFunction } from "express";
import express from "express";
import Redis from 'ioredis'
import multer from 'multer'
import fs, { ReadStream } from 'fs'
import bodyParser from 'body-parser'
import * as util from './util'
import path from 'path'
const unzip = require('unzip-stream')
const vhost = require('vhost')


export interface Version {
    major:number
    minor:number
    patch:number
}

export type DeployType='major' | 'minor' | 'patch'

interface SiteSetting<IDType>{
    name:string
    host:string | string[]
    protocol:string[],
    key:string
    /**
     * 路由, 或者 路由-路径 的映射列表
     */
    route?:string | {[key:string]:string|string[]}

    resultCallback?: (err?:{name:string,error:string}, msg?:{name:string,id:IDType}) =>void
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
    groupName:string
    sites:SiteSetting<IDType>[],
    redisUrl?:string
    tmpPath:string
    deployPath:string
    saveCallback:SaveCallback<IDType>

    restoreCallback:RestoreCallback<IDType>

    changeCurrentDeployCallback:ChangeCurrentDeployCallback<IDType>
}

// interface DeploySetting<T> extends ConstructorParam<T>{
//     redisSub?:Redis.Redis
//     redisPub?:Redis.Redis
//     multer:multer.Instance
// }

const CHANNEL_PREFIX = 'deploy-site-channel:'
// let channel = CHANNEL_PREFIX
export class DeploySite<IDType>{
    private channel:string
    private redisSub?:Redis.Redis
    private redisPub?:Redis.Redis
    private multer:multer.Instance
    private saveCallback:SaveCallback<IDType>

    private restoreCallback:RestoreCallback<IDType>

    private changeCurrentDeployCallback:ChangeCurrentDeployCallback<IDType>
    private deployPath:string
    // private resultCallback: (err?:{name:string,error:string}, msg?:any) =>void

    private siteSettings:SiteSetting<IDType>[]  = []
    constructor(params:ConstructorParam<IDType>){
        this.siteSettings = params.sites
        this.multer = multer({dest:params.tmpPath})
        this.saveCallback = params.saveCallback
        this.restoreCallback = params.restoreCallback
        this.changeCurrentDeployCallback = params.changeCurrentDeployCallback
        this.channel = CHANNEL_PREFIX+params.groupName
        this.deployPath = params.deployPath
        // this.resultCallback = params.resultCallback || function(x,y){}
        if(params.redisUrl){
            this.redisSub = new Redis(params.redisUrl,{maxRetriesPerRequest: null})
            this.redisPub = new Redis(params.redisUrl,{maxRetriesPerRequest: null})
            this.redisSub.subscribe(this.channel)
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
            console.log(name+' 部署版本改变为 id '+params.id+' 发送部署消息')
            this.redisPub.publish(this.channel,name)
        }else{
            console.log(name+' 部署版本改变为 id '+params.id+' 部署本机')
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
            // let app = Router()
            // console.log('create routerUpload for '+ e.name+' '+e.route)
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
            
            const host = e.host
            const name = e.name
            router.post('/'+encodeURIComponent(e.name), this.multer.single('app'), async (req, res) => {
                console.log('更新部署 '+name)
                if (!(req.file && req.file.path)) {
                    res.send('Invalid params')
                    e.resultCallback && e.resultCallback({name,error: 'Invalid params'},undefined)
                    return
                }
                if (!req.body['type']) {
                    res.send('Missing type params')
                    e.resultCallback && e.resultCallback({name,error:'Missing type params'},undefined)
                    return
                }
                if (req.body['key']!=e.key) {
                    res.send('Invalid key:'+req.body['key'])
                    e.resultCallback && e.resultCallback({name,error: 'Invalid key:'+req.body['key']},undefined)
                    return
                }
                let type = req.body['type'] as DeployType
                let newest = await this.restoreCallback({
                    name,
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
                    name,
                    zipFile:fs.createReadStream(req.file.path),
                    type:type,
                    version:version
                })
                await this.setDeploy({id})
                e.resultCallback && e.resultCallback(undefined,{id,name})
                res.send()
            })
            // host.forEach(h=>{
            //     router.use(vhost(h, app))
            // })
        })
        // console.log('create routerUpload')
        return router
    }

    routerHost():Router{
        let router = Router()
        // router.use(bodyParser.json());
        // router.use(bodyParser.urlencoded({
        //     extended: false
        // }));
        this.siteSettings.forEach(e=>{
            console.log('create routerHost for '+ e.name)
            let app = Router()
            let deployPath = path.join(this.deployPath,encodeURIComponent(e.name))

            let routes:{[key:string]:string|string[]} = {}
            if(! e.route){
                routes['/'] = ''
            }else if(typeof e.route == 'string'){
                routes[e.route] =''
            }else{
                routes = e.route
            }

            let host:string[]
            if(typeof e.host == 'string'){
                host = [e.host]
            }{
                host = e.host as string[]
            }
            
            const protocol = e.protocol
            // app.use('/static-'+e.key,express.static(e.deployPath))
            // app.use((req: Request, res: Response, next: NextFunction)=>{
            //     if (host.includes(req.hostname) && protocol.includes(req.protocol)){
            //         next()
            //         // next(e.route +'/static-'+e.key)
            //     }else{
            //         // next()
            //         // res.status(404)
            //         // res.send()
            //     }
            // })
            Object.keys(routes).forEach(r=>{
                let paths:string[];
                if(typeof routes[r] == 'string'){
                    paths = [routes[r] as string]
                }else{
                    paths = routes[r] as string[]
                }
                paths.forEach(p=>{
                    console.log('route:'+r+' -> '+path.join(deployPath,p))
                    app.use(r,express.static(path.join(deployPath,p)))
                })
            })
            host.forEach(h=>{
                console.log('vhost:'+h )
                // app.use(vhost(h, express.static(e.deployPath)))
                router.use(vhost(h,app))
            })
            // router.use(e.route,app)
        })
        // console.log('create routerHost')
        return router
    }

    /**
     * 
     * @param name 指定部署的网站,空则全部部署
     */
    async deploy(name?:string){
        if(name){
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
                path:path.join(this.deployPath,encodeURIComponent(name)),
                zipUrl:deploy[0].zipUrl
            })
        }else{
            for(let i=0;i<this.siteSettings.length;++i){
                await this.deploy(this.siteSettings[i].name)
            }
        }
    }

    private handleRedisMessage(name:string){
        console.log('分组接收部署通知 '+name)
        this.deploy(name)
    }
    private async _deploy( params:{
        path:string
        zipUrl:string
    } ){
        console.log('_deploy:'+params.zipUrl+' -> '+params.path )
        let file = await util.tmpFileFromUrl(params.zipUrl)
        fs.createReadStream(file.path).pipe(unzip.Extract({ path: params.path }))
    }
}