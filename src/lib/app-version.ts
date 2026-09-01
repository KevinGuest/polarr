import packageJson from "../../package.json";

/** Release version, overridable by the Umbrel container metadata. */
export const POLARR_APP_VERSION =
  process.env.POLARR_APP_VERSION || packageJson.version;
