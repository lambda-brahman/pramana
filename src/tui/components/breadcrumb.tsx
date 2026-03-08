import { Box, Text } from "ink";

type Props = {
  segments: string[];
};

export function Breadcrumb({ segments }: Props) {
  const last = segments.length - 1;
  return (
    <Box>
      <Text>
        {segments.map((seg, i) => {
          if (i === last) return seg;
          return `${seg} > `;
        })}
      </Text>
    </Box>
  );
}
