/// <reference types="node" />
import { Router } from "express";
import { ReadStream } from 'fs';
export interface Version {
    major: number;
    minor: number;
    patch: number;
}
export declare type DeployType = 'major' | 'minor' | 'patch';
interface SiteSetting<IDType> {
    name: string;
    deployPath: string;
    host: string[];
    protocol: string[];
    key: string;
    route: string;
}
declare type SaveCallback<T> = (params: {
    name: string;
    zipFile: ReadStream;
    type: DeployType;
    version: Version;
}) => Promise<T>;
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
}) => Promise<{
    name: string;
    current: boolean;
    type: DeployType;
    version: Version;
    zipUrl: string;
    id: A;
}[]>;
declare type ChangeCurrentDeployCallback<T> = (params: {
    id: T;
}) => Promise<{
    name: string;
}>;
interface ConstructorParam<IDType> {
    sites: SiteSetting<IDType>[];
    redisUrl?: string;
    tmpPath: string;
    saveCallback: SaveCallback<IDType>;
    restoreCallback: RestoreCallback<IDType>;
    changeCurrentDeployCallback: ChangeCurrentDeployCallback<IDType>;
    resultCallback?: (err: any, msg: any) => void;
}
export declare class DeploySite<IDType> {
    private redisSub?;
    private redisPub?;
    private multer;
    private saveCallback;
    private restoreCallback;
    private changeCurrentDeployCallback;
    private resultCallback;
    private siteSettings;
    constructor(params: ConstructorParam<IDType>);
    setDeploy(params: {
        id: IDType;
    }): Promise<void>;
    /**
     * 根路由必须加载 bodyParser
     */
    routerUpload(): Router;
    routerHost(): Router;
    /**
     *
     * @param name 指定部署的网站,空则全部部署
     */
    deploy(name?: string): Promise<void>;
    private handleRedisMessage;
    private _deploy;
}
export {};
//# sourceMappingURL=index.d.ts.map