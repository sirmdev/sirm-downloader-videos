import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['node_modules/eslint/bin/eslint.js','.'],{stdio:'inherit'});
if(result.error)console.error('Execute npm ci para instalar as ferramentas de desenvolvimento.');
process.exitCode=result.status ?? 1;
