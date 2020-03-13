# deploy-site

## 接口说明与使用例子
```typescript
import AV from 'leancloud-storage'
import { DeploySite, Version, DeployType } from 'deploy-site'
import { ReadStream } from 'fs';

// 存储部署信息的leancloud表
const CLASSNAME = 'Deploy'
const LEANCLOUD_APP_GROUP = process.env.LEANCLOUD_APP_GROUP || 'local'
export let deploySite = new DeploySite<string>({
  // 设置部署组名,防止不同组直接传递redis消息
  groupName: LEANCLOUD_APP_GROUP,
  // 如果有多个实例,需设置redis地址,使用redis传递消息,提交新部署时让所有实例同时执行部署. 
  // 如果没有设置此项,则只会部署在接收到部署请求的实例上执行部署更新
  redisUrl: process.env.REDIS_URL_pteppp_cache,
  // 临时目录
  tmpPath: 'tmp',
  // 部署的本地存储地址
  deployPath: 'public',
  // 将部署保存在leancloud的 'Deploy' 表中
  saveCallback:async (params:{
    name:string
    zipFile:ReadStream, 
    type: string,
    version: Version
  }) => {
    let {name,zipFile,type,version} = params
    let result = await new AV.Object(CLASSNAME).set({
      name,
      type,
      version,
      file: new AV.File(name, zipFile)
    }).save()
    return result.get('objectId')
  },
  // 从leancloud的 'Deploy' 表中读取需要的部署数据
  restoreCallback:async (
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
    id?:string
    }) => {
    let { name, newest, onlyCurrent, id } = params
    if (newest) {
      let result = await new AV.Query<AV.Object>(CLASSNAME).equalTo('name',name).descending('createdAt').first()
      return (result&&[AVObject2Deploy(result)]) || []
    }
    if (onlyCurrent) {
      let result = await new AV.Query<AV.Object>(CLASSNAME)
        .equalTo('name', name)
        .equalTo('current', true)
        .descending('createdAt').first()
      return (result&&[AVObject2Deploy(result)]) || []
    }
    if (id) {
      let result = await new AV.Query<AV.Object>(CLASSNAME).get(id)
      return (result&&[AVObject2Deploy(result)]) || []
    }
    return (await new AV.Query<AV.Object>(CLASSNAME).equalTo('name', name).descending('createdAt').find())
      .map(e =>AVObject2Deploy(e))
  },

   //改变部署的版本
  changeCurrentDeployCallback: async (params: {id: string})=>{
    let { id } = params
    let result = await new AV.Query<AV.Object>(CLASSNAME).get(id)
    let name = result.get('name')

    // 当前版本的 current 字段为true , 一个name下, 只能有一个current 为true的数据
    let results = await new AV.Query<AV.Object>(CLASSNAME)
      .equalTo('name', name)
      .equalTo('current', true)
      .find()
    if (results.length > 0) {
      results.map(e => e.set('current', false))
      AV.Object.saveAll(results)
    }
    await result.set('current', true).save()
    return {name}
  },
  // 站点信息
  sites: [
    {
      // 网站名, 通过网站名识别提交的部署,和切换版本
      name: 'test',
      // 网站域名
      host: ['test.site.com'],
      // 支持端口,暂时不会进行此内容判断
      protocol: ['http','https'],
      //部署密匙,防止恶意调用
      key: 'deploykey',
      // 网站的根路径
      route: '/',
      //部署回调
      resultCallback:(err?:{name:string,error:string}, msg?:{name:string,id:string}) => {
            if(err) console.log(err.name+' error : '+err.error)
            if(msg) console.log(msg.name+' deploy succeed id : '+ msg.id)
       }
    },
  ]
})

if (process.env.NODE_ENV) {
  // 启动时执行部署操作
  deploySite.deploy()
}

import express from 'express'

var app = express()
// 注册部署的路由
// 部署的rest接口为. post: 域名/deploy-upload/encodeURIComponent(name)  表单内容为
// key: 部署密匙 , app: 网站内容的zip压缩包 , type: 更新类型,内容为 pacth, minor, major
app.use('/deploy-upload', deploySite.routerUpload())

// 注册网站的路由
app.use('/', deploySite.routerHost())

// 因为网站的路由为 '/' 要比部署路由后注册, 否则上传部署时会先符合网站路由的规则, 导致访问的是网站路由

```
## 数据表结构
### DeployConfig表
用于部署配置
```
name:string -- 部署名, 用以标示不同的网站提交内容
key:string -- 部署key, 用以认证部署提交
route:{[key:string]:string} -- 路由-文件夹路径 的映射列表 . 留空表示根路由使用根目录
host:string[] -- 访问此网站的域名
link: string -- 部署信息提示工具中的链接, 用了指向部署的目标网站
```

### Deploy表
作为部署实例, 用于部署记录, 和存储部署包内容
```
name:string -- 部署名, 和 Deploy表 中的name对应
file:AV.File -- 部署内容的压缩文件
type:'patch'|'minor'|'major'  -- 版本推进类型
current:boolean -- 是否是此name配置下当前使用的版本, 一个name下只能有一个current为true的部署
version:{patch:number,minor:number,major:number} -- 此部署的版本
```

## 管理系统功能
1. 添加/删除/修改 DeployConfig 条目
2. 查看某个网站配置下的所有部署
3. 更改某个网站部署的当前使用版本, 通过云函数 Deploy.SetDeploy({id:string}) 设置部署的objectId 来更改
