import { Box, Text } from "ink";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { theme } from "../theme.ts";

type Props<T> = {
  items: T[];
  selectedIndex: number;
  height: number;
  renderItem: (item: T, index: number, isSelected: boolean) => ReactNode;
  itemHeight?: (item: T, index: number) => number;
  emptyMessage?: string;
};

export function ScrollableList<T>({
  items,
  selectedIndex,
  height,
  renderItem,
  itemHeight,
  emptyMessage = "No items",
}: Props<T>) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const viewportHeight = Math.max(1, height);

  const getItemHeight = useCallback(
    (index: number) => {
      const item = items[index];
      return item !== undefined && itemHeight ? itemHeight(item, index) : 1;
    },
    [items, itemHeight],
  );

  const endIndexForOffset = useCallback(
    (offset: number): number => {
      let consumed = 0;
      let i = offset;
      while (i < items.length) {
        const h = getItemHeight(i);
        if (consumed + h > viewportHeight && i > offset) break;
        consumed += h;
        i++;
      }
      return i;
    },
    [items.length, getItemHeight, viewportHeight],
  );

  useEffect(() => {
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex);
    } else if (selectedIndex >= endIndexForOffset(scrollOffset)) {
      let consumed = getItemHeight(selectedIndex);
      let newOffset = selectedIndex;
      while (newOffset > 0 && consumed + getItemHeight(newOffset - 1) <= viewportHeight) {
        newOffset--;
        consumed += getItemHeight(newOffset);
      }
      setScrollOffset(newOffset);
    }
  }, [selectedIndex, viewportHeight, scrollOffset, endIndexForOffset, getItemHeight]);

  const endIndex = useMemo(
    () => endIndexForOffset(scrollOffset),
    [endIndexForOffset, scrollOffset],
  );

  const visibleItems = useMemo(
    () => items.slice(scrollOffset, endIndex),
    [items, scrollOffset, endIndex],
  );

  if (items.length === 0) {
    return <Text color={theme.muted}>{emptyMessage}</Text>;
  }

  const showScrollUp = scrollOffset > 0;
  const showScrollDown = endIndex < items.length;

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
          {"  ↓"} {items.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
}
