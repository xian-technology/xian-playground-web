"use client";

import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ContractView } from "@/lib/playground/controller";

import { useController, usePlayground } from "./context";

interface ContractPickerProps {
  label: string;
  contracts: ContractView[];
  value: string;
  onChange(name: string): void;
}

export function ContractPicker({ label, contracts, value, onChange }: ContractPickerProps) {
  const id = useId();
  return (
    <div className="grid min-w-0 flex-1 gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={onChange} disabled={contracts.length === 0}>
        <SelectTrigger id={id} className="h-8 w-full font-mono text-[0.8rem]">
          <SelectValue placeholder="No contracts yet" />
        </SelectTrigger>
        <SelectContent>
          {contracts.map((contract) => (
            <SelectItem key={contract.name} value={contract.name} className="font-mono text-[0.8rem]">
              {contract.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The shared "show system contracts" switch (old playground: hidden by default). */
export function SystemContractsSwitch({ hiddenCount }: { hiddenCount: number }) {
  const controller = useController();
  const show = usePlayground((state) => state.ui.showSystemContracts);
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={show} onCheckedChange={(checked) => controller.setUi({ showSystemContracts: checked })} />
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Show system contracts{!show && hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
      </label>
    </div>
  );
}

interface ConfirmProps {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm(): void;
  destructive?: boolean;
}

export function Confirm({ trigger, title, description, confirmLabel, onConfirm, destructive = true }: ConfirmProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function EmptyState({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children?: ReactNode }) {
  return (
    <Empty className="flex-1 border-0 p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-sm">{title}</EmptyTitle>
        <EmptyDescription className="text-xs">{description}</EmptyDescription>
      </EmptyHeader>
      {children}
    </Empty>
  );
}
