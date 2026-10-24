/** Local launchers must never inherit a separately configured public testnet app profile. */
export function localDemoEnv(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...environment };
  delete result.ONEUP_PUBLIC_CONFIG;
  return result;
}
