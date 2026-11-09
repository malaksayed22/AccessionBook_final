import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * next-intl types the values of `t.rich` as text or tag functions, yet it renders a React element
 * given for a plain `{placeholder}` exactly where the placeholder stands. That is how a name inside a
 * translated sentence ("Received from {organization}") becomes a link without touching the sentence
 * in either language. This helper is the one place that says so.
 *
 * `t.rich` returns its pieces as an array, so the element needs a key: it takes `key`, or one made
 * from the entity it shows. Give two placeholders of one sentence different keys.
 */
export const richValue = (node: ReactNode, key?: string) => {
  if (!isValidElement<{ kind?: string; id?: number | null }>(node))
    return node as unknown as string;
  const own = `${node.props.kind ?? "node"}-${node.props.id ?? "none"}`;
  return cloneElement(node as ReactElement, { key: key ?? own }) as unknown as string;
};
