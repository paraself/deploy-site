import tmp from 'tmp-promise';
/**
 * 返回tmp-promise创建的临时文件对象
 * @function tmpFile
 * @param  {string} postfix 一般是文件类型，例如：“.txt"
 * @param  {string} prefix 文件的开头，例如：“prefix-”
 * @return {Promise<tmp.FileResult>} 返回一个临时文件，tmp-promise创建的对象
 */
export declare function tmpFile(postfix?: string, prefix?: string): Promise<tmp.FileResult>;
/**
 * 从url下载一个文件，并保存在outputPath上
 * @param  {string} url 文件的url地址
 * @param  {string} outputPath 需要存储到的本地路径
 * @return {Promise<string>} 如果成功的话，则返回本地文件路径, 也就是outputPath
 */
export declare function downloadFile(url: string, outputPath: string): Promise<string>;
/**
 * 从URL下载临时文件到临时目录，返回 tmp-promise 的临时文件格式
 */
export declare function tmpFileFromUrl(url: string, postfix?: string, prefix?: string): Promise<tmp.FileResult>;
//# sourceMappingURL=util.d.ts.map