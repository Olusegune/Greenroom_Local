import { api } from "./api";
import { directorCloud, type EnginesCfg } from "./engines";

/** Send one Director request to the cloud provider chosen in Engines (Kie, OpenAI or Gemini). The local Director does not come through here. */
export const askCloud = (engines: Pick<EnginesCfg, "directorEngine" | "directorModel">, system: string, user: string): Promise<string> => {
  const c = directorCloud(engines);
  return api.directorComplete(system, user, c.provider, c.model);
};
