/** Header actions on the whole workspace: share, export, import and examples. */

import { toast } from "sonner";

import { errorMessage } from "@/lib/errors";
import type { PlaygroundController } from "@/lib/playground/controller";
import { parseWorkspaceDoc, type WorkspaceDoc } from "@/lib/workspace/model";
import { encodeShareFragment } from "@/lib/workspace/share";

import { EXAMPLES } from "./examples";

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export async function copyShareLink(controller: PlaygroundController): Promise<void> {
  try {
    const fragment = await encodeShareFragment(controller.exportDoc());
    await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${fragment}`);
    toast.success("Share link copied.", { description: "Anyone with the link gets a copy of this workspace." });
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

export function downloadWorkspace(controller: PlaygroundController): void {
  const text = JSON.stringify(controller.exportDoc(), null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `xian-playground-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** A validated workspace from an export file, or null after telling the user why not. */
export async function readWorkspaceFile(file: File): Promise<WorkspaceDoc | null> {
  if (file.size > IMPORT_MAX_BYTES) {
    toast.error("This file is larger than 10 MB.");
    return null;
  }
  try {
    return parseWorkspaceDoc(JSON.parse(await file.text()));
  } catch (error) {
    toast.error(`Could not read ${file.name}: ${errorMessage(error)}`);
    return null;
  }
}

/** Put an example in the editor, with Undo in the confirmation toast. */
export function loadExample(controller: PlaygroundController, id: string): void {
  const example = EXAMPLES.find((item) => item.id === id);
  if (!example) return;
  const previous = controller.getState().doc.editor;
  controller.setEditor({ code: example.code, contractName: example.contractName });
  toast.success(`Loaded the ${example.title} example.`, {
    action: { label: "Undo", onClick: () => controller.setEditor(previous) },
  });
}
