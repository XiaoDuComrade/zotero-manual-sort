import hooks from "./hooks";
import { ManualSortController } from "./zotero/manual-sort-controller";

export class Addon {
  readonly controller: ManualSortController;
  readonly hooks = hooks;
  alive = true;

  constructor() {
    this.controller = new ManualSortController();
  }
}
