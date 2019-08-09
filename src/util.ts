
import fs from 'fs'
import tmp from 'tmp-promise'
import path from 'path'
import download from 'download'


/**
 * 返回tmp-promise创建的临时文件对象
 * @function tmpFile
 * @param  {string} postfix 一般是文件类型，例如：“.txt"
 * @param  {string} prefix 文件的开头，例如：“prefix-”
 * @return {Promise<tmp.FileResult>} 返回一个临时文件，tmp-promise创建的对象
 */
export function tmpFile(postfix?: string, prefix?: string) {
    const options: { [key: string]: any } = {
      dir: path.resolve('tmp')
    }
    if (prefix) options.prefix = prefix
    if (postfix) options.postfix = postfix
    return tmp.file({
      postfix,
      prefix
    })
  }

/**
 * 从url下载一个文件，并保存在outputPath上
 * @param  {string} url 文件的url地址
 * @param  {string} outputPath 需要存储到的本地路径
 * @return {Promise<string>} 如果成功的话，则返回本地文件路径, 也就是outputPath
 */
export function downloadFile(url: string, outputPath: string): Promise<string> {
    outputPath = path.resolve(outputPath)
    return download(url).then(buffer => {
      return new Promise<string>((resolve, reject) => {
        fs.writeFile(outputPath, buffer, err => {
          if (err) reject(err)
          else resolve(outputPath)
        })
      })
    })
  }
  
/**
 * 从URL下载临时文件到临时目录，返回 tmp-promise 的临时文件格式
 */
export async function tmpFileFromUrl(url: string, postfix?:string, prefix?:string):Promise<tmp.FileResult> {
    const file = await tmpFile(postfix, prefix)
    const url2Path = await downloadFile(url, file.path)
    return Promise.resolve(file)
  }