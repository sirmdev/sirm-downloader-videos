import js from '@eslint/js';
import globals from 'globals';
export default [
  {ignores:['node_modules/**','test-results/**','work/**','Instalado/**','dist/**']},
  js.configs.recommended,
  {files:['**/*.mjs'],languageOptions:{ecmaVersion:2023,sourceType:'module',globals:{...globals.node}}},
  {files:['extension/*.mjs'],languageOptions:{globals:{...globals.browser,chrome:'readonly'}},rules:{'no-control-regex':'off'}},
  {files:['native/core.mjs'],rules:{'no-control-regex':'off'}}
];
