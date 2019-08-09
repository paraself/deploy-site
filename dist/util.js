"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const tmp_promise_1 = __importDefault(require("tmp-promise"));
const path_1 = __importDefault(require("path"));
const download_1 = __importDefault(require("download"));
/**
 * 返回tmp-promise创建的临时文件对象
 * @function tmpFile
 * @param  {string} postfix 一般是文件类型，例如：“.txt"
 * @param  {string} prefix 文件的开头，例如：“prefix-”
 * @return {Promise<tmp.FileResult>} 返回一个临时文件，tmp-promise创建的对象
 */
function tmpFile(postfix, prefix) {
    const options = {
        dir: path_1.default.resolve('tmp')
    };
    if (prefix)
        options.prefix = prefix;
    if (postfix)
        options.postfix = postfix;
    return tmp_promise_1.default.file({
        postfix,
        prefix
    });
}
exports.tmpFile = tmpFile;
/**
 * 从url下载一个文件，并保存在outputPath上
 * @param  {string} url 文件的url地址
 * @param  {string} outputPath 需要存储到的本地路径
 * @return {Promise<string>} 如果成功的话，则返回本地文件路径, 也就是outputPath
 */
function downloadFile(url, outputPath) {
    outputPath = path_1.default.resolve(outputPath);
    return download_1.default(url).then(buffer => {
        return new Promise((resolve, reject) => {
            fs_1.default.writeFile(outputPath, buffer, err => {
                if (err)
                    reject(err);
                else
                    resolve(outputPath);
            });
        });
    });
}
exports.downloadFile = downloadFile;
/**
 * 从URL下载临时文件到临时目录，返回 tmp-promise 的临时文件格式
 */
async function tmpFileFromUrl(url, postfix, prefix) {
    const file = await tmpFile(postfix, prefix);
    const url2Path = await downloadFile(url, file.path);
    return Promise.resolve(file);
}
exports.tmpFileFromUrl = tmpFileFromUrl;
//# sourceMappingURL=util.js.map