"use client";
// beui.dev/components/agents/prompt-input

import { ArrowUp, Plus, Square } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type FormEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
  useRef,
  useState,
} from "react";
import { Button } from "@/renderer/components/motion/button";
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "@/renderer/components/motion/popover-morph";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/renderer/components/motion/select";
import { SPRING_SWAP } from "@/renderer/lib/ease";
import { cn } from "@/renderer/lib/cn";
import { PromptEditor, type ChipInfo, type PromptEditorHandle } from "./prompt-editor";

export interface PromptModel {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PromptAction {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PromptInputProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "defaultValue" | "onChange" | "onSubmit" | "children" | "onKeyDown"
> {
  /** Runs before the editor handles a key; call `preventDefault` to claim it. */
  onKeyDown?: (event: KeyboardEvent, context: { textBeforeCaret: string }) => void;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  models?: PromptModel[];
  model?: string;
  defaultModel?: string;
  onModelChange?: (model: string) => void;
  actions?: PromptAction[];
  onAction?: (action: string) => void;
  onSubmit?: (value: string, model?: string) => void | Promise<void>;
  loading?: boolean;
  onStop?: () => void;
  /** Ctrl/Cmd+Enter while `loading` — the alternate busy-lane (queue vs steer, per settings). */
  onSendNow?: (value: string, model?: string) => void;
  /** Ctrl/Cmd+Enter while `loading` with an empty draft — e.g. steer every queued message at once. */
  onEmptySendNow?: () => void;
  /** Tooltip tail for the send button while a run is live (describes the Ctrl+Enter lane). */
  busySendTitle?: string;
  minRows?: number;
  maxRows?: number;
  leadingAction?: ReactNode;
  /** Resolves `[n]` citations in the draft to inline chips; `open` runs when a chip is clicked. */
  chips?: { info(label: number): ChipInfo | undefined; open(label: number): void };
  /** Imperative access to the editor: focus, insert a range chip at the caret. */
  editorRef?: Ref<PromptEditorHandle>;
  className?: string;
}

export function PromptInput({
  value,
  defaultValue = "",
  onValueChange,
  models = [],
  model,
  defaultModel,
  onModelChange,
  actions = [],
  onAction,
  onSubmit,
  loading = false,
  onStop,
  onSendNow,
  onEmptySendNow,
  busySendTitle,
  minRows = 2,
  maxRows = 8,
  leadingAction,
  chips,
  editorRef,
  className,
  disabled,
  placeholder = "Ask the agent to do something…",
  "aria-label": ariaLabel = "Prompt",
  onKeyDown,
  ...textareaProps
}: PromptInputProps) {
  const reduce = useReducedMotion() ?? false;
  const localEditorRef = useRef<PromptEditorHandle>(null);
  const setEditorRef = (handle: PromptEditorHandle | null) => {
    (localEditorRef as { current: PromptEditorHandle | null }).current = handle;
    if (typeof editorRef === "function") editorRef(handle);
    else if (editorRef) (editorRef as { current: PromptEditorHandle | null }).current = handle;
  };
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [internalModel, setInternalModel] = useState(
    defaultModel ?? models[0]?.value,
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const currentValue = value ?? internalValue;
  const currentModelValue = model ?? internalModel;
  const currentModel = models.find(
    (option) => option.value === currentModelValue,
  );
  const hasDraft = Boolean(currentValue.trim());
  const canSubmit = hasDraft && !disabled;
  // While a run is live the button is a stop control only when the box is
  // empty; with text it becomes the queue/send button so Enter keeps working.
  const showStop = loading && !hasDraft;

  const setValue = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  const setModel = (next: string) => {
    if (model === undefined) setInternalModel(next);
    onModelChange?.(next);
  };

  const fire = (sendNow: boolean) => {
    const prompt = currentValue.trim();
    if (sendNow && !prompt && loading && !disabled) {
      onEmptySendNow?.();
      return;
    }
    if (!prompt || disabled) return;

    if (sendNow && loading && onSendNow) {
      onSendNow(prompt, currentModelValue);
    } else {
      onSubmit?.(prompt, currentModelValue);
    }
    if (value === undefined) setInternalValue("");
    localEditorRef.current?.focus();
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    fire(false);
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "relative w-full rounded-2xl border border-border/80 bg-background p-2 transition-colors focus-within:border-foreground/25",
        disabled && "opacity-60",
        className,
      )}
    >
      <PromptEditor
        ref={setEditorRef}
        value={currentValue}
        onChange={setValue}
        chips={chips}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={textareaProps.autoFocus}
        minRows={minRows}
        maxRows={maxRows}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        onEnter={fire}
      />

      <div className="mt-1 flex min-h-8 min-w-0 items-center gap-1">
        {actions.length ? (
          <MorphPopover open={actionsOpen} onOpenChange={setActionsOpen}>
            <MorphPopoverTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || loading}
                aria-label="Add to prompt"
                className="size-8 rounded-full"
              >
                <motion.span
                  aria-hidden="true"
                  animate={{ rotate: actionsOpen ? 45 : 0 }}
                  transition={reduce ? { duration: 0 } : SPRING_SWAP}
                >
                  <Plus className="size-4" />
                </motion.span>
              </Button>
            </MorphPopoverTrigger>

            <MorphPopoverContent
              side="top"
              align="start"
              sideOffset={8}
              radius={12}
              className="w-56 p-1.5"
            >
              {actions.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    onAction?.(action.value);
                    setActionsOpen(false);
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                  {action.icon ? (
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">
                      {action.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">
                      {action.label}
                    </span>
                    {action.description ? (
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                        {action.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </MorphPopoverContent>
          </MorphPopover>
        ) : null}
        {leadingAction}
        {models.length ? (
          <Select
            value={currentModelValue}
            onValueChange={setModel}
            disabled={disabled || loading}
            className="min-w-0"
          >
            <SelectTrigger className="h-8 w-auto max-w-52 rounded-xl border-0 bg-transparent px-2 py-0 text-xs hover:bg-muted focus-visible:ring-2">
              <span className="flex min-w-0 items-center gap-1.5">
                {currentModel?.icon ? (
                  <span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5">
                    {currentModel.icon}
                  </span>
                ) : null}
                <span className="truncate text-muted-foreground">
                  {currentModel?.label ?? "Choose model"}
                </span>
              </span>
            </SelectTrigger>
            <SelectContent className="right-auto w-52 shadow-none">
              {models.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.icon ? (
                      <span className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">
                        {option.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {option.label}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Button
          type={showStop ? "button" : "submit"}
          size="icon"
          disabled={showStop ? !onStop : !canSubmit}
          aria-label={showStop ? "Stop generating" : loading ? "Queue message" : "Send prompt"}
          title={
            showStop
              ? "停止生成"
              : loading
                ? (busySendTitle ?? "Enter 排队发送")
                : "发送"
          }
          onClick={showStop ? onStop : undefined}
          className="ml-auto size-8 rounded-full"
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={showStop ? "stop" : "send"}
              initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.8 }}
              transition={reduce ? { duration: 0 } : SPRING_SWAP}
              className="grid place-items-center"
            >
              {showStop ? (
                <Square className="size-3 fill-current" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </motion.span>
          </AnimatePresence>
        </Button>
      </div>
    </form>
  );
}
