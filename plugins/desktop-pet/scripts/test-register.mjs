/**
 * 测试入口预载：把 test-ts-resolver 注册成模块解析钩子。
 * 只做注册，不改解析策略、不注入全局变量。
 * 由 package.json 的 test 脚本以 --import 引入，仅对测试进程生效。
 * @module dsh-pet/scripts/test-register
 */
import { register } from 'node:module';

register('./test-ts-resolver.mjs', import.meta.url);
