import { Text, useInput } from "ink";
import { theme } from "../theme.ts";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isActive?: boolean;
};

export function TextInput({ value, onChange, placeholder, isActive = true }: Props) {
  useInput(
    (input, key) => {
      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        onChange(value + input);
      }
    },
    { isActive },
  );

  if (!value && placeholder) {
    return (
      <Text>
        <Text color={theme.muted}>{placeholder}</Text>
        {isActive && <Text inverse> </Text>}
      </Text>
    );
  }

  return (
    <Text>
      {value}
      {isActive && <Text inverse> </Text>}
    </Text>
  );
}
