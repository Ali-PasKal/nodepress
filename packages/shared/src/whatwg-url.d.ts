/**
 * Minimal declaration of the WHATWG URL class, which exists in every runtime this package targets
 * (browsers and Node.js). Declared here so the package needs neither DOM nor Node type definitions.
 */
declare class URL {
  constructor(input: string, base?: string);
  readonly protocol: string;
  readonly host: string;
  readonly search: string;
  readonly hash: string;
  readonly username: string;
  readonly password: string;
}
