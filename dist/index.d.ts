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
    host: string | string[];
    protocol: string[];
    key: string;
    /**
     * 路由, 或者 路由-路径 的映射列表
     */
    route?: string | {
        [key: string]: string | string[];
    };
    resultCallback?: (err?: {
        name: string;
        error: string;
    }, msg?: {
        name: string;
        id: IDType;
    }) => void;
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
    groupName: string;
    sites: SiteSetting<IDType>[];
    redisUrl?: string;
    tmpPath: string;
    deployPath: string;
    saveCallback: SaveCallback<IDType>;
    restoreCallback: RestoreCallback<IDType>;
    changeCurrentDeployCallback: ChangeCurrentDeployCallback<IDType>;
}
export declare class DeploySite<IDType> {
    private channel;
    private redisSub?;
    private redisPub?;
    private multer;
    private saveCallback;
    private restoreCallback;
    private changeCurrentDeployCallback;
    private deployPath;
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