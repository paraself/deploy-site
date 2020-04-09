import { Router, Request,Response, NextFunction, RequestHandler } from "express";
import express from "express";
import Redis from 'ioredis'
import multer from 'multer'
import fs, { ReadStream } from 'fs'
import bodyParser from 'body-parser'
import * as util from './util'
import path from 'path'
import {ReloadRouter} from "express-route-reload";
const unzip = require('unzip-stream')
const vhost = require('vhost')


export interface Version {
    major:number
    minor:number
    patch:number
}

export type DeployType='major' | 'minor' | 'patch'

interface SiteSetting<IDType>{
    /**
     * 部署名, 用以标示不同的网站提交内容
     */
    name:string
    /**
     * 访问此网站的域名
     */
    host:string | string[]
    protocol:string[],
    /**
     * 部署key, 用以认证部署提交
     */
    key:string
    /**
     * 路由, 或者 路由-路径 的映射列表
     */
    route?:string | {[key:string]:string}

    resultCallback?: (err?:{name:string,error:string}, msg?:{name:string,id:IDType}) =>void

    /**
     * 是否强制使用https, 非https访问则跳转到https
     */
    forceHttps?: boolean
    /**
     * 是否强制使用非www, www地址则跳转到非www地址
     */
    nonWww?: boolean
    /**
     * 使用fallback的路由, 没有静态资源时, 跳转到路由的根路径
     */
    historyFallback? : string[]
}

type SaveCallback<T> = (
    params: {
        name:string
        zipFile:ReadStream, 
        type: DeployType,
        version:Version
    })=>Promise<T>

// type RestoreCallbackReturn1<A> = { name:string, current:boolean , type:DeployType, version: Version,zipUrl:string, id:A }
// type RestoreCallbackReturn2<A> = { name:string, current:boolean , type:DeployType, version: Version,zipPath:string, id:A }
// type RestoreCallbackReturn<A> = RestoreCallbackReturn1<A> | RestoreCallbackReturn2<A>
type RestoreCallbackReturn<A> = { name:string, current:boolean , type:DeployType, version: Version,zipUrl?:string,zipPath?:string, id:A }
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
})=> Promise< RestoreCallbackReturn<A>[] >

type ChangeCurrentDeployCallback<T> = (params: {
    id:T
})=>Promise< {name:string} >

export type SiteSettingFunction<IDType> = ()=>Promise<SiteSetting<IDType>[]>

interface ConstructorParam<IDType>{
    groupName:string
    sites:SiteSetting<IDType>[] | SiteSettingFunction<IDType>,
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

/**
 * 找到所有此host下的路由
 */
function FindAllRoutesInHosts(sites:SiteSetting<any>[],hosts:string[]):string[]{
    let results : string[] = []
    for(let i=0;i<sites.length;++i){
        let site = sites[i]
        
        let host:string[]
        if(typeof site.host == 'string'){
            host = [site.host]
        }else{
            host = site.host as string[]
        }
        //host 是否有交集
        if(hosts.filter(e=>host.includes(e)).length==0){
            continue
        }
        let routes:{[key:string]:string|string[]} = {}
        if(! site.route){
            routes['/'] = ''
        }else if(typeof site.route == 'string'){
            routes[site.route] =''
        }else{
            routes = site.route
        }
        results.push( ...Object.keys(routes) )
    }
    return [...new Set(results)]
}

const CHANNEL_DEPLOY_PREFIX = 'deploy-site-channel:deploy:'
const CHANNEL_SETSITES_PREFIX = 'deploy-site-channel:setsites:'
// let channel = CHANNEL_PREFIX
export class DeploySite<IDType>{
    private channelDeploy:string
    private channelSetsites:string
    private redisSub?:Redis.Redis
    private redisPub?:Redis.Redis
    private multer:multer.Instance
    private saveCallback:SaveCallback<IDType>

    private restoreCallback:RestoreCallback<IDType>

    private changeCurrentDeployCallback:ChangeCurrentDeployCallback<IDType>
    private deployPath:string
    // private resultCallback: (err?:{name:string,error:string}, msg?:any) =>void

    public siteSettings:SiteSetting<IDType>[]|SiteSettingFunction<IDType>
    private hostRouter = new ReloadRouter();
    private uploadRouter:ReloadRouter = new ReloadRouter();
    constructor(params:ConstructorParam<IDType>){
        this.siteSettings = params.sites
        this.multer = multer({dest:params.tmpPath})
        this.saveCallback = params.saveCallback
        this.restoreCallback = params.restoreCallback
        this.changeCurrentDeployCallback = params.changeCurrentDeployCallback
        this.channelDeploy = CHANNEL_DEPLOY_PREFIX+params.groupName
        this.channelSetsites = CHANNEL_SETSITES_PREFIX+params.groupName
        this.deployPath = params.deployPath
        // this.resultCallback = params.resultCallback || function(x,y){}
        if(params.redisUrl){
            this.redisSub = new Redis(params.redisUrl,{maxRetriesPerRequest: null})
            this.redisPub = new Redis(params.redisUrl,{maxRetriesPerRequest: null})
            this.redisSub.subscribe(this.channelDeploy)
            this.redisSub.subscribe(this.channelSetsites)
            this.redisSub.on('message', (channel, message)=>{
                if(channel==this.channelDeploy){
                    this.handleRedisDeployMessage(message)
                }else if(channel==this.channelSetsites){
                    this.handleRedisResetSiteMessage()
                }
            })
        }
        let defaultRouter = Router()
        defaultRouter.get('/', (req, res, next)=>{
            res.send('')
        })
        this.hostRouter.reload([defaultRouter])
        this.setSites()
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
            this.redisPub.publish(this.channelDeploy,name)
        }else{
            console.log(name+' 部署版本改变为 id '+params.id+' 部署本机')
            this.deploy(name)
        }
    }

    /**
     * 通过 this.siteSettings 重新设置网站配置信息,并重新部署
     */
    async resetSites(){
        if(this.redisPub){
            console.log('重设部署设置-发送消息')
            this.redisPub.publish(this.channelSetsites,'')
        }else{
            console.log('重设部署设置')
            await this.setSites()
            // await this.deploy()
        }
    }

    async getSites(){
        let siteSettings: SiteSetting<IDType>[]
        if(typeof this.siteSettings == 'function'){
            siteSettings = await this.siteSettings()
        }else{
            siteSettings = this.siteSettings
        }
        return siteSettings
    }

    /**
     * 应用网站配置信息
     */
    private async setSites(){
        let siteSettings = await this.getSites()
        this.hostRouter.reload([this._routerHost(siteSettings)])
        this.uploadRouter.reload([this._routerUpload(siteSettings)])
    }

    /**
     * 根路由必须加载 bodyParser
     */
    routerUpload():RequestHandler{
        return this.uploadRouter.handler()
    }
    private _routerUpload(siteSettings: SiteSetting<IDType>[]):Router{
        let router = Router()
        // router.use(bodyParser.json());
        // router.use(bodyParser.urlencoded({
        //     extended: false
        // }));
        siteSettings.forEach(e=>{
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

    routerHost():RequestHandler{
        return this.hostRouter.handler()
    }
    private _routerHost(siteSettings: SiteSetting<IDType>[]):Router{
        let router = Router()
        // router.use(bodyParser.json());
        // router.use(bodyParser.urlencoded({
        //     extended: false
        // }));
        // 让所有路由路径都以 /  开头
        siteSettings.forEach(e=>{
            let routes:{[key:string]:string} = {}
            if(! e.route){
                routes['/'] = ''
            }else if(typeof e.route == 'string'){
                routes[e.route] =''
            }else{
                routes = e.route
            }
            Object.keys(routes).forEach(e => {
              if(!e.startsWith('/')){
                routes['/' + e] = routes[e]
                delete routes[e]
              }
            })
            e.route = routes

            e.historyFallback && e.historyFallback.forEach((v,i)=>{
                if(!v.startsWith('/')){
                    e.historyFallback![i] = '/'+v
                }
            })
        })
        siteSettings.forEach(e=>{
            console.log('create routerHost for '+ e.name)
            let app = Router()
            let deployPath = path.join(this.deployPath,encodeURIComponent(e.name))

            let host:string[]
            if(typeof e.host == 'string'){
                host = [e.host]
            }else{
                host = e.host as string[]
            }
            const routes = e.route as {[key:string]:string}
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
                // let paths:string[];
                // if(typeof routes[r] == 'string'){
                //     paths = [routes[r] as string]
                // }else{
                //     paths = routes[r] as string[]
                // }
                const paths = [routes[r] as string]
                paths.forEach(p=>{
                    console.log('route:'+r+' -> '+path.join(deployPath,p))
                    if(e.forceHttps || e.nonWww){
                        app.use(r,(req: Request, res: Response, next: NextFunction)=>{
                            if (req.hostname === 'localhost' || req.hostname.startsWith('127.0.0.1')) {
                                return next();
                            }
                            let protocol = req.protocol
                            /**
                             * https://stackoverflow.com/a/7014324
                             *  better to use req.headers.host (per the actual answer), vs. req.host as had also been suggested. 
                             * The reason is that req.host strips the port number, so if you're not on the default :80 or :443 ports (e.g., express' default of :3000), 
                             * you'll break the URL
                             */
                            let hostname = req.headers.host || req.hostname
                            let needRedirect = false
                            if(e.forceHttps && protocol=='http'){
                                protocol = 'https'
                                needRedirect = true
                            }
                            if(e.nonWww && hostname.startsWith('www.')){
                                hostname = hostname.replace(/^www\./, '')
                                needRedirect = true
                            }
                            if (!needRedirect || req.hostname === 'localhost' || req.hostname.startsWith('127.0.0.1')) {
                                return next();
                            }
                            res.redirect( protocol + '://' + hostname + req.originalUrl);
                        })
                    }
                    app.use(r,express.static(path.join(deployPath,p)))
                    if(e.historyFallback&&e.historyFallback.includes(r)){
                        // 找到所有此host下的其他路由
                        let otherRoutes = FindAllRoutesInHosts(siteSettings,host).filter(e=>e!=r)
                        app.use(r,(req: Request, res: Response, next: NextFunction)=>{
                            let otherFitRoutes = otherRoutes.filter(r=>req.originalUrl.startsWith(r))
                            let maxLength = Math.max(...otherFitRoutes.map(e=>e.length)) 
                            // 判断自身是否是所有路由配置中最长的(最符合的)
                            if(r.length>=maxLength){
                                req.url = r
                                next();
                                // res.redirect( req.protocol + '://' + (req.headers.host || req.hostname) + r);
                            }else{
                                next();
                            }
                        })
                    }
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
    async deploy(name?:string,siteSettings?: SiteSetting<IDType>[]){
        siteSettings = siteSettings || await this.getSites()
        if(name){
            let site = siteSettings.find(x=>x.name==name)
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
                //@ts-ignore
                zipUrl:deploy[0].zipUrl,
                //@ts-ignore
                zipPath:deploy[0].zipPath
            })
        }else{
            let list:Promise<any>[] = []
            for(let i=0;i<siteSettings.length;++i){
                list.push( this.deploy(siteSettings[i].name,siteSettings) )
            }
            return Promise.all(list)
        }
    }

    private handleRedisDeployMessage(name:string){
        console.log('分组接收部署通知 '+name)
        this.deploy(name)
    }

    private async handleRedisResetSiteMessage(){
        console.log('分组接收更新网站配置通知'+name)
        await this.setSites()
        // await this.deploy()
    }

    private async _deploy( params:{
        path:string
        zipUrl?:string
        zipPath?:string
    } ){
        console.log('_deploy:'+params.zipUrl||params.zipPath+' -> '+params.path )
        if(params.zipUrl){
            let file = await util.tmpFileFromUrl(params.zipUrl)
            fs.createReadStream(file.path).pipe(unzip.Extract({ path: params.path }))
        }else if(params.zipPath){
            fs.createReadStream(params.zipPath).pipe(unzip.Extract({ path: params.path }))
        }
    }
}