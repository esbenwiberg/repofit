import contextDimension from "./dimensions/context.js";
import agentGuidancePresent from "./probes/agent-guidance-present.js";

export const meta = {
  name: "@esbenwiberg/corpus-default",
  version: "0.0.0",
};

export const probes = [agentGuidancePresent];

export const dimensions = [contextDimension];

export const CORPUS_VERSION = meta.version;
