"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import type { PlaygroundController, PlaygroundState } from "@/lib/playground/controller";

export const ControllerContext = createContext<PlaygroundController | null>(null);

export function useController(): PlaygroundController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error("useController must be used inside the playground");
  return controller;
}

/** Subscribe to one slice of the playground state. */
export function usePlayground<T>(select: (state: PlaygroundState) => T): T {
  const controller = useController();
  return useSyncExternalStore(
    controller.subscribe,
    () => select(controller.getState()),
    () => select(controller.getState()),
  );
}
