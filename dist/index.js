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
const unzip = require('unzip-stream');
// interface DeploySetting<T> extends ConstructorParam<T>{
//     redisSub?:Redis.Redis
//     redisPub?:Redis.Redis
//     multer:multer.Instance
// }
const channel = 'deploy-site-channel';
class DeploySite {
    constructor(params) {
        this.siteSettings = [];
        this.siteSettings = params.sites;
        this.multer = multer_1.default({ dest: params.tmpPath });
        this.saveCallback = params.saveCallback;
        this.restoreCallback = params.restoreCallback;
        this.changeCurrentDeployCallback = params.changeCurrentDeployCallback;
        this.resultCallback = params.resultCallback || function (x, y) { };
        if (params.redisUrl) {
            this.redisSub = new ioredis_1.default(params.redisUrl, { maxRetriesPerRequest: null });
            this.redisPub = new ioredis_1.default(params.redisUrl, { maxRetriesPerRequest: null });
            this.redisSub.subscribe(channel);
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
            this.redisPub.publish(channel, name);
        }
        else {
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
            let app = express_1.Router();
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
                    res.send('Invalid params');
                    this.resultCallback('Invalid params', null);
                    return;
                }
                if (!req.body['type']) {
                    res.send('Missing type params');
                    this.resultCallback('Missing type params', null);
                    return;
                }
                if (req.body['key'] != e.key) {
                    res.send('Invalid key:' + req.body['key']);
                    this.resultCallback('Invalid key:' + req.body['key'], null);
                    return;
                }
                let type = req.body['type'];
                let newest = await this.restoreCallback({
                    name: e.name,
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
                    name: e.name,
                    zipFile: fs_1.default.createReadStream(req.file.path),
                    type: type,
                    version: version
                });
                await this.setDeploy({ id });
                this.resultCallback(null, id);
                res.send();
            });
            router.use(e.route, app);
        });
        return router;
    }
    routerHost() {
        let router = express_1.Router();
        // router.use(bodyParser.json());
        // router.use(bodyParser.urlencoded({
        //     extended: false
        // }));
        this.siteSettings.forEach(e => {
            let app = express_1.Router();
            const host = e.host;
            const protocol = e.protocol;
            app.use('/static-' + e.key, express_2.default.static(e.deployPath));
            app.use((req, res, next) => {
                if (host.includes(req.hostname) && protocol.includes(req.protocol)) {
                    // next()
                    next(e.route + '/static-' + e.key);
                }
                else {
                    next();
                    // res.status(404)
                    // res.send()
                }
            });
            router.use(e.route, app);
        });
        return router;
    }
    /**
     *
     * @param name 指定部署的网站,空则全部部署
     */
    async deploy(name) {
        if (name) {
            console.log('deploy ' + name);
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
                path: site.deployPath,
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
        this.deploy(name);
    }
    async _deploy(params) {
        let file = await util.tmpFileFromUrl(params.zipUrl);
        fs_1.default.createReadStream(file.path).pipe(unzip.Extract({ path: params.path }));
    }
}
exports.DeploySite = DeploySite;
//# sourceMappingURL=index.js.map