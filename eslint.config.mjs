import tseslint from "typescript-eslint";
export default [{ignores:["dist/**",".vinext/**","node_modules/**",".output/**"]},...tseslint.configs.recommended];
