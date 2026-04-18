import { Color } from "../color.object";

export interface AttributeSelectOption<T = unknown> {
  label: string;
  value: T;
}

interface AttributeBase<
  TInput extends keyof AttributeInputTypeMap = keyof AttributeInputTypeMap,
  TOutput extends string = string
> {
  label: string;
  name: string;
  input: TInput;
  output: TOutput;
}

interface AttributeInputTypeMap {
  number: number;
  text: string;
  range: number;
  color: Color | null;
  select: unknown;
  bool: boolean;
}

export interface AttributeNumber<TOutput extends string = string>
  extends AttributeBase<"number", TOutput> {}

export interface AttributeText<TOutput extends string = string>
  extends AttributeBase<"text", TOutput> {}

export interface AttributeRange<TOutput extends string = string>
  extends AttributeBase<"range", TOutput> {
  min: number;
  max: number;
}

export interface AttributeColor<TOutput extends string = string>
  extends AttributeBase<"color", TOutput> {}

export interface AttributeSelect<
  TOutput extends string = string,
  TValue = unknown
> extends AttributeBase<"select", TOutput> {
  options: readonly AttributeSelectOption<TValue>[];
}

export interface AttributeBool<TOutput extends string = string>
  extends AttributeBase<"bool", TOutput> {}

export type ElementAttribute =
  | AttributeNumber
  | AttributeText
  | AttributeRange
  | AttributeColor
  | AttributeSelect
  | AttributeBool;

type AttributeValue<T extends ElementAttribute> =
  T extends { input: "number" } ? number :
  T extends { input: "text" } ? string :
  T extends { input: "range" } ? number :
  T extends { input: "color" } ? Color | null :
  T extends { input: "bool" } ? boolean :
  T extends { input: "select"; options: readonly (infer O)[] }
    ? O extends { value: infer V }
      ? V | null
      : never
    : never;

export type SettingsFromAttributes<
  T extends readonly ElementAttribute[]
> = {
  [A in T[number] as A["output"]]: AttributeValue<A>;
};