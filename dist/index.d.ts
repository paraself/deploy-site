/// <reference types="node" />
import { RequestHandler } from "express";
import { ReadStream } from 'fs';
export interface Version {
    major: number;
    minor: number;
    patch: number;
}
export declare type DeployType = 'major' | 'minor' | 'patch';
interface SiteSetting<IDType> {
    /**
     * 部署名, 用以标示不同的网站提交内容
     */
    name: string;
    /**
     * 访问此网站的域名
     */
    host: string | string[];
    protocol: string[];
    /**
     * 部署key, 用以认证部署提交
     */
    key: string;
    /**
     * 路由, 或者 路由-路径 的映射列表
     */
    route?: string | {
        [key: string]: string;
    };
    resultCallback?: (err?: {
        name: string;
        error: string;
    }, msg?: {
        name: string;
        id: IDType;
    }) => void;
    /**
     * 是否强制使用https, 非https访问则跳转到https
     */
    forceHttps?: boolean;
    /**
     * 是否强制使用非www, www地址则跳转到非www地址
     */
    nonWww?: boolean;
    /**
     * 使用fallback的路由, 没有静态资源时, 跳转到路由的根路径
     */
    historyFallback?: string[];
}
declare type SaveCallback<T> = (params: {
    name: string;
    zipFile: ReadStream;
    type: DeployType;
    version: Version;
}) => Promise<T>;
declare type RestoreCallbackReturn<A> = {
    name: string;
    current: boolean;
    type: DeployType;
    version: Version;
    zipUrl?: string;
    zipPath?: string;
    id: A;
};
declare type RestoreCallback<A> = (params: {
    name?: string;
    /**
     * 是否只返回最新版本
     */
    newest?: boolean;
    /**
     * 是否只返回需部署版本
     */
    onlyCurrent?: boolean;
    /**
     * 只返回指定的id的内容
     */
    id?: A;
}) => Promise<RestoreCallbackReturn<A>[]>;
declare type ChangeCurrentDeployCallback<T> = (params: {
    id: T;
}) => Promise<{
    name: string;
}>;
export declare type SiteSettingFunction<IDType> = () => Promise<SiteSetting<IDType>[]>;
interface ConstructorParam<IDType> {
    groupName: string;
    sites: SiteSetting<IDType>[] | SiteSettingFunction<IDType>;
    redisUrl?: string;
    tmpPath: string;
    deployPath: string;
    saveCallback: SaveCallback<IDType>;
    restoreCallback: RestoreCallback<IDType>;
    changeCurrentDeployCallback: ChangeCurrentDeployCallback<IDType>;
}
export declare class DeploySite<IDType> {
    private channelDeploy;
    private channelSetsites;
    private redisSub?;
    private redisPub?;
    private multer;
    private saveCallback;
    private restoreCallback;
    private changeCurrentDeployCallback;
    private deployPath;
    siteSettings: SiteSetting<IDType>[] | SiteSettingFunction<IDType>;
    private hostRouter;
    private uploadRouter;
    constructor(params: ConstructorParam<IDType>);
    setDeploy(params: {
        id: IDType;
    }): Promise<void>;
    /**
     * 通过 this.siteSettings 重新设置网站配置信息,并重新部署
     */
    resetSites(): Promise<void>;
    getSites(): Promise<SiteSetting<IDType>[]>;
    /**
     * 应用网站配置信息
     */
    private setSites;
    /**
     * 根路由必须加载 bodyParser
     */
    routerUpload(): RequestHandler;
    private _routerUpload;
    routerHost(): RequestHandler;
    private _routerHost;
    /**
     *
     * @param name 指定部署的网站,空则全部部署
     */
    deploy(name?: string, siteSettings?: SiteSetting<IDType>[]): Promise<void | any[]>;
    private handleRedisDeployMessage;
    private handleRedisResetSiteMessage;
    private _deploy;
}
export {};
//# sourceMappingURL=index.d.ts.map