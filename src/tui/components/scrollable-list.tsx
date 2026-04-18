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
    (offset: number, limit: number): number => {
      let consumed = 0;
      let i = offset;
      while (i < items.length) {
        const h = getItemHeight(i);
        if (consumed + h > limit && i > offset) break;
        consumed += h;
        i++;
      }
      return i;
    },
    [items.length, getItemHeight],
  );

  // Two-pass: reserve lines for visible scroll indicators before computing end index.
  // Pass 1 uses height minus the scroll-up indicator (known from offset).
  // Pass 2 subtracts the scroll-down indicator if one would appear.
  const effectiveEndIndex = useCallback(
    (offset: number): number => {
      const scrollUpLines = offset > 0 ? 1 : 0;
      const heightAfterUp = Math.max(1, viewportHeight - scrollUpLines);
      const pass1End = endIndexForOffset(offset, heightAfterUp);
      const scrollDownLines = pass1End < items.length ? 1 : 0;
      const effectiveHeight = Math.max(1, heightAfterUp - scrollDownLines);
      return endIndexForOffset(offset, effectiveHeight);
    },
    [viewportHeight, endIndexForOffset, items.length],
  );

  useEffect(() => {
    if (selectedIndex < 0) return;
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex);
    } else if (selectedIndex >= effectiveEndIndex(scrollOffset)) {
      let consumed = getItemHeight(selectedIndex);
      let newOffset = selectedIndex;
      while (newOffset > 0) {
        const candidateOffset = newOffset - 1;
        // Reserve indicator lines at the candidate offset:
        // scroll-up if candidateOffset > 0; scroll-down if items follow selectedIndex.
        const scrollUpLines = candidateOffset > 0 ? 1 : 0;
        const scrollDownLines = selectedIndex < items.length - 1 ? 1 : 0;
        const limit = Math.max(1, viewportHeight - scrollUpLines - scrollDownLines);
        if (consumed + getItemHeight(candidateOffset) > limit) break;
        newOffset--;
        consumed += getItemHeight(newOffset);
      }
      setScrollOffset(newOffset);
    }
  }, [selectedIndex, viewportHeight, scrollOffset, effectiveEndIndex, getItemHeight, items.length]);

  const endIndex = useMemo(
    () => effectiveEndIndex(scrollOffset),
    [effectiveEndIndex, scrollOffset],
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
