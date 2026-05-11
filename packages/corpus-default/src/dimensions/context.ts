import { defineDimension } from "@esbenwiberg/repofit/sdk";

export default defineDimension({
  id: "context",
  name: "Context",
  description: "Can the agent understand this repo on first read?",
  gating: false,
});
