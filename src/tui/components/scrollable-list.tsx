import { Box, Text } from "ink";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { theme } from "../theme.ts";

type Props<T> = {
  items: T[];
  selectedIndex: number;
  height: number;
  renderItem: (item: T, index: number, isSelected: boolean) => ReactNode;
  emptyMessage?: string;
};

export function ScrollableList<T>({
  items,
  selectedIndex,
  height,
  renderItem,
  emptyMessage = "No items",
}: Props<T>) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const viewportHeight = Math.max(1, height);

  useEffect(() => {
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex);
    } else if (selectedIndex >= scrollOffset + viewportHeight) {
      setScrollOffset(selectedIndex - viewportHeight + 1);
    }
  }, [selectedIndex, viewportHeight, scrollOffset]);

  const visibleItems = useMemo(
    () => items.slice(scrollOffset, scrollOffset + viewportHeight),
    [items, scrollOffset, viewportHeight],
  );

  if (items.length === 0) {
    return <Text color={theme.muted}>{emptyMessage}</Text>;
  }

  const showScrollUp = scrollOffset > 0;
  const showScrollDown = scrollOffset + viewportHeight < items.length;

  return (
    <Box flexDirection="column">
      {showScrollUp && (
        <Text color={theme.muted}>
          {" "}
          {"↑"} {scrollOffset} more above
        </Text>
      )}
      {visibleItems.map((item, i) => {
        const actualIndex = scrollOffset + i;
        return (
          <Fragment key={actualIndex}>
            {renderItem(item, actualIndex, actualIndex === selectedIndex)}
          </Fragment>
        );
      })}
      {showScrollDown && (
        <Text color={theme.muted}>
          {"  ↓"} {items.length - scrollOffset - viewportHeight} more below
        </Text>
      )}
    </Box>
  );
}
