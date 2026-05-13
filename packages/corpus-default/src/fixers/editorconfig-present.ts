import { defineFixer } from "@esbenwiberg/repofit/sdk";

const EDITORCONFIG = `root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
`;

export default defineFixer({
  probeId: "editorconfig.present",
  mode: "static",
  describe: "write .editorconfig",
  async plan() {
    return {
      actions: [
        { kind: "write-file", path: ".editorconfig", content: EDITORCONFIG, ifMissing: true },
      ],
    };
  },
});
