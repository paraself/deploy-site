"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_2 = __importDefault(require("express"));
const ioredis_1 = __importDefault(require("ioredis"));
const multer_1 = __importDefault(require("multer"));
const fs_1 = __importDefault(require("fs"));
const util = __importStar(require("./util"));
const path_1 = __importDefault(require("path"));
const express_route_reload_1 = require("express-route-reload");
const unzip = require('unzip-stream');
const vhost = require('vhost');
// interface DeploySetting<T> extends ConstructorParam<T>{
//     redisSub?:Redis.Redis
//     redisPub?:Redis.Redis
//     multer:multer.Instance
// }
/**
 * 找到所有此host下的路由
 */
function FindAllRoutesInHosts(sites, hosts) {
    let results = [];
    for (let i = 0; i < sites.length; ++i) {
        let site = sites[i];
        let host;
        if (typeof site.host == 'string') {
            host = [site.host];
        }
        else {
            host = site.host;
        }
        //host 是否有交集
        if (hosts.filter(e => host.includes(e)).length == 0) {
            continue;
        }
        let routes = {};
        if (!site.route) {
            routes['/'] = '';
        }
        else if (typeof site.route == 'string') {
            routes[site.route] = '';
        }
        else {
            routes = site.route;
        }
        results.push(...Object.keys(routes));
    }
    return [...new Set(results)];
}
const CHANNEL_DEPLOY_PREFIX = 'deploy-site-channel:deploy:';
const CHANNEL_SETSITES_PREFIX = 'deploy-site-channel:setsites:';
// let channel = CHANNEL_PREFIX
class DeploySite {
    constructor(params) {
        this.hostRouter = new express_route_reload_1.ReloadRouter();
        this.uploadRouter = new express_route_reload_1.ReloadRouter();
        this.siteSettings = params.sites;
        this.multer = multer_1.default({ dest: params.tmpPath });
        this.saveCallback = params.saveCallback;
        this.restoreCallback = params.restoreCallback;
        this.changeCurrentDeployCallback = params.changeCurrentDeployCallback;
        this.channelDeploy = CHANNEL_DEPLOY_PREFIX + params.groupName;
        this.channelSetsites = CHANNEL_SETSITES_PREFIX + params.groupName;
        this.deployPath = params.deployPath;
        // this.resultCallback = params.resultCallback || function(x,y){}
        if (params.redisUrl) {
            this.redisSub = new ioredis_1.default(params.redisUrl, { maxRetriesPerRequest: null });
            this.redisPub = new ioredis_1.default(params.redisUrl, { maxRetriesPerRequest: null });
            this.redisSub.subscribe(this.channelDeploy);
            this.redisSub.subscribe(this.channelSetsites);
            this.redisSub.on('message', (channel, message) => {
                if (channel == this.channelDeploy) {
                    this.handleRedisDeployMessage(message);
                }
                else if (channel == this.channelSetsites) {
                    this.handleRedisResetSiteMessage();
                }
            });
        }
        let defaultRouter = express_1.Router();
        defaultRouter.get('/', (req, res, next) => {
            res.send('');
        });
        this.hostRouter.reload([defaultRouter]);
        this.setSites();
    }
    async setDeploy(params) {
        let results = await this.restoreCallback({ id: params.id });
        if (results.length < 0) {
            throw new Error('Can find deploy ' + params.id);
        }
        let result = results[0];
        await this.changeCurrentDeployCallback({ id: result.id });
        let name = result.name;
        if (this.redisPub) {
            console.log(name + ' 部署版本改变为 id ' + params.id + ' 发送部署消息');
            this.redisPub.publish(this.channelDeploy, name);
        }
        else {
            console.log(name + ' 部署版本改变为 id ' + params.id + ' 部署本机');
            this.deploy(name);
        }
    }
    /**
     * 通过 this.siteSettings 重新设置网站配置信息,并重新部署
     */
    async resetSites() {
        if (this.redisPub) {
            console.log('重设部署设置-发送消息');
            this.redisPub.publish(this.channelSetsites, '');
        }
        else {
            console.log('重设部署设置');
            await this.setSites();
            // await this.deploy()
        }
    }
    async getSites() {
        let siteSettings;
        if (typeof this.siteSettings == 'function') {
            siteSettings = await this.siteSettings();
        }
        else {
            siteSettings = this.siteSettings;
        }
        return siteSettings;
    }
    /**
     * 应用网站配置信息
     */
    async setSites() {
        let siteSettings = await this.getSites();
        this.hostRouter.reload([this._routerHost(siteSettings)]);
        this.uploadRouter.reload([this._routerUpload(siteSettings)]);
    }
    /**
     * 根路由必须加载 bodyParser
     */
    routerUpload() {
        return this.uploadRouter.handler();
    }
    _routerUpload(siteSettings) {
        let router = express_1.Router();
        // router.use(bodyParser.json());
        // router.use(bodyParser.urlencoded({
        //     extended: false
        // }));
        siteSettings.forEach(e => {
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
            const host = e.host;
            const name = e.name;
            router.post('/' + encodeURIComponent(e.name), this.multer.single('app'), async (req, res) => {
                console.log('更新部署 ' + name);
                if (!(req.file && req.file.path)) {
                    res.send('Invalid params');
                    e.resultCallback && e.resultCallback({ name, error: 'Invalid params' }, undefined);
                    return;
                }
                if (!req.body['type']) {
                    res.send('Missing type params');
                    e.resultCallback && e.resultCallback({ name, error: 'Missing type params' }, undefined);
                    return;
                }
                if (req.body['key'] != e.key) {
                    res.send('Invalid key:' + req.body['key']);
                    e.resultCallback && e.resultCallback({ name, error: 'Invalid key:' + req.body['key'] }, undefined);
                    return;
                }
                let type = req.body['type'];
                let newest = await this.restoreCallback({
                    name,
                    newest: true
                });
                let version = (newest[0] && newest[0].version) || { major: 1, patch: 0, minor: 0 };
                version[type] = (version[type] || 0) + 1;
                if (type == 'major') {
                    version.patch = 0;
                    version.minor = 0;
                }
                else if (type == 'minor') {
                    version.patch = 0;
                }
                let id = await this.saveCallback({
                    name,
                    zipFile: fs_1.default.createReadStream(req.file.path),
                    type: type,
                    version: version
                });
                await this.setDeploy({ id });
                e.resultCallback && e.resultCallback(undefined, { id, name });
                res.send();
            });
            // host.forEach(h=>{
            //     router.use(vhost(h, app))
            // })
        });
        // console.log('create routerUpload')
        return router;
    }
    routerHost() {
        return this.hostRouter.handler();
    }
    _routerHost(siteSettings) {
        let router = express_1.Router();
        // router.use(bodyParser.json());
        // router.use(bodyParser.urlencoded({
        //     extended: false
        // }));
        siteSettings.forEach(e => {
            console.log('create routerHost for ' + e.name);
            let app = express_1.Router();
            let deployPath = path_1.default.join(this.deployPath, encodeURIComponent(e.name));
            let routes = {};
            if (!e.route) {
                routes['/'] = '';
            }
            else if (typeof e.route == 'string') {
                routes[e.route] = '';
            }
            else {
                routes = e.route;
            }
            let host;
            if (typeof e.host == 'string') {
                host = [e.host];
            }
            else {
                host = e.host;
            }
            const protocol = e.protocol;
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
            Object.keys(routes).forEach(r => {
                let paths;
                if (typeof routes[r] == 'string') {
                    paths = [routes[r]];
                }
                else {
                    paths = routes[r];
                }
                paths.forEach(p => {
                    console.log('route:' + r + ' -> ' + path_1.default.join(deployPath, p));
                    if (e.forceHttps || e.nonWww) {
                        app.use(r, (req, res, next) => {
                            if (req.hostname === 'localhost' || req.hostname.startsWith('127.0.0.1')) {
                                return next();
                            }
                            let protocol = req.protocol;
                            /**
                             * https://stackoverflow.com/a/7014324
                             *  better to use req.headers.host (per the actual answer), vs. req.host as had also been suggested.
                             * The reason is that req.host strips the port number, so if you're not on the default :80 or :443 ports (e.g., express' default of :3000),
                             * you'll break the URL
                             */
                            let hostname = req.headers.host || req.hostname;
                            let needRedirect = false;
                            if (e.forceHttps && protocol == 'http') {
                                protocol = 'https';
                                needRedirect = true;
                            }
                            if (e.nonWww && hostname.startsWith('www.')) {
                                hostname = hostname.replace(/^www\./, '');
                                needRedirect = true;
                            }
                            if (!needRedirect || req.hostname === 'localhost' || req.hostname.startsWith('127.0.0.1')) {
                                return next();
                            }
                            res.redirect(protocol + '://' + hostname + req.originalUrl);
                        });
                    }
                    app.use(r, express_2.default.static(path_1.default.join(deployPath, p)));
                    if (e.historyFallback && e.historyFallback.includes(r)) {
                        // 找到所有此host下的其他路由
                        let otherRoutes = FindAllRoutesInHosts(siteSettings, host).filter(e => e != r);
                        app.use(r, (req, res, next) => {
                            let otherFitRoutes = otherRoutes.filter(r => req.originalUrl.includes(r));
                            let maxLength = Math.max(...otherFitRoutes.map(e => e.length));
                            // 判断自身是否是所有路由配置中最长的(最符合的)
                            if (r.length >= maxLength) {
                                if (!r.startsWith('/')) {
                                    r = '/' + r;
                                }
                                res.redirect(req.protocol + '://' + (req.headers.host || req.hostname) + r);
                            }
                            else {
                                next();
                            }
                        });
                    }
                });
            });
            host.forEach(h => {
                console.log('vhost:' + h);
                // app.use(vhost(h, express.static(e.deployPath)))
                router.use(vhost(h, app));
            });
            // router.use(e.route,app)
        });
        // console.log('create routerHost')
        return router;
    }
    /**
     *
     * @param name 指定部署的网站,空则全部部署
     */
    async deploy(name, siteSettings) {
        siteSettings = siteSettings || await this.getSites();
        if (name) {
            let site = siteSettings.find(x => x.name == name);
            if (!site) {
                throw new Error('Can find site ' + name);
            }
            let deploy = await this.restoreCallback({ name, onlyCurrent: true });
            if (deploy.length == 0) {
                deploy = await this.restoreCallback({ name, newest: true });
            }
            if (deploy.length == 0) {
                console.error('Can not find deploy :' + name);
                return;
            }
            return this._deploy({
                path: path_1.default.join(this.deployPath, encodeURIComponent(name)),
                //@ts-ignore
                zipUrl: deploy[0].zipUrl,
                //@ts-ignore
                zipPath: deploy[0].zipPath
            });
        }
        else {
            let list = [];
            for (let i = 0; i < siteSettings.length; ++i) {
                list.push(this.deploy(siteSettings[i].name, siteSettings));
            }
            return Promise.all(list);
        }
    }
    handleRedisDeployMessage(name) {
        console.log('分组接收部署通知 ' + name);
        this.deploy(name);
    }
    async handleRedisResetSiteMessage() {
        console.log('分组接收更新网站配置通知' + name);
        await this.setSites();
        // await this.deploy()
    }
    async _deploy(params) {
        console.log('_deploy:' + params.zipUrl || params.zipPath + ' -> ' + params.path);
        if (params.zipUrl) {
            let file = await util.tmpFileFromUrl(params.zipUrl);
            fs_1.default.createReadStream(file.path).pipe(unzip.Extract({ path: params.path }));
        }
        else if (params.zipPath) {
            fs_1.default.createReadStream(params.zipPath).pipe(unzip.Extract({ path: params.path }));
        }
    }
}
exports.DeploySite = DeploySite;
//# sourceMappingURL=index.js.map