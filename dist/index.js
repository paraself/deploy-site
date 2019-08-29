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
const unzip = require('unzip-stream');
const vhost = require('vhost');
// interface DeploySetting<T> extends ConstructorParam<T>{
//     redisSub?:Redis.Redis
//     redisPub?:Redis.Redis
//     multer:multer.Instance
// }
const CHANNEL_PREFIX = 'deploy-site-channel:';
// let channel = CHANNEL_PREFIX
class DeploySite {
    constructor(params) {
        // private resultCallback: (err?:{name:string,error:string}, msg?:any) =>void
        this.siteSettings = [];
        this.siteSettings = params.sites;
        this.multer = multer_1.default({ dest: params.tmpPath });
        this.saveCallback = params.saveCallback;
        this.restoreCallback = params.restoreCallback;
        this.changeCurrentDeployCallback = params.changeCurrentDeployCallback;
        this.channel = CHANNEL_PREFIX + params.groupName;
        this.deployPath = params.deployPath;
        // this.resultCallback = params.resultCallback || function(x,y){}
        if (params.redisUrl) {
            this.redisSub = new ioredis_1.default(params.redisUrl, { maxRetriesPerRequest: null });
            this.redisPub = new ioredis_1.default(params.redisUrl, { maxRetriesPerRequest: null });
            this.redisSub.subscribe(this.channel);
            this.redisSub.on('message', (channel, message) => this.handleRedisMessage(message));
        }
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
            this.redisPub.publish(this.channel, name);
        }
        else {
            console.log(name + ' 部署版本改变为 id ' + params.id + ' 部署本机');
            this.deploy(name);
        }
    }
    /**
     * 根路由必须加载 bodyParser
     */
    routerUpload() {
        let router = express_1.Router();
        // router.use(bodyParser.json());
        // router.use(bodyParser.urlencoded({
        //     extended: false
        // }));
        this.siteSettings.forEach(e => {
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
        let router = express_1.Router();
        // router.use(bodyParser.json());
        // router.use(bodyParser.urlencoded({
        //     extended: false
        // }));
        this.siteSettings.forEach(e => {
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
            {
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
                    app.use(r, express_2.default.static(path_1.default.join(deployPath, p)));
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
    async deploy(name) {
        if (name) {
            let site = this.siteSettings.find(x => x.name == name);
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
                zipUrl: deploy[0].zipUrl
            });
        }
        else {
            for (let i = 0; i < this.siteSettings.length; ++i) {
                await this.deploy(this.siteSettings[i].name);
            }
        }
    }
    handleRedisMessage(name) {
        console.log('分组接收部署通知 ' + name);
        this.deploy(name);
    }
    async _deploy(params) {
        console.log('_deploy:' + params.zipUrl + ' -> ' + params.path);
        let file = await util.tmpFileFromUrl(params.zipUrl);
        fs_1.default.createReadStream(file.path).pipe(unzip.Extract({ path: params.path }));
    }
}
exports.DeploySite = DeploySite;
//# sourceMappingURL=index.js.map