import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from './icons';
import { DisclosureButton } from './ui';
import { cx } from './ui/utils';

export interface ComposerActivityItem {
  id: string;
  title: string;
  summary: string;
  content: ReactNode;
  defaultOpen?: boolean;
  variant?: 'default' | 'plain';
}

export function ComposerActivityShelf({ items }: { items: ComposerActivityItem[] }) {
  const itemSignature = useMemo(
    () => items.map((item) => `${item.id}:${item.summary}:${item.defaultOpen ? '1' : '0'}`).join('|'),
    [items]
  );
  const plainOnly = items.length === 1 && items[0]?.variant === 'plain';
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedById((current) => {
      const next = Object.fromEntries(
        items.map((item) => [item.id, current[item.id] ?? Boolean(item.defaultOpen)])
      ) as Record<string, boolean>;
      return next;
    });
  }, [itemSignature, items]);

  if (items.length === 0) {
    return null;
  }

  return (
    <section
      className={cx('composer-activity-shelf', plainOnly && 'has-plain-only')}
      data-testid="composer-activity-shelf"
      aria-label="Composer activity"
    >
      {items.map((item) => {
        const expanded = expandedById[item.id] ?? Boolean(item.defaultOpen);
        return (
          <section
            key={item.id}
            className={cx(
              'composer-activity-card',
              item.variant === 'plain' && 'is-plain',
              expanded && 'is-expanded'
            )}
          >
            <DisclosureButton
              className="composer-activity-card-toggle"
              align="start"
              onClick={() =>
                setExpandedById((current) => ({
                  ...current,
                  [item.id]: !expanded
                }))
              }
              aria-expanded={expanded}
            >
              <span className="composer-activity-card-heading">
                <span className="composer-activity-shelf-chevron" aria-hidden="true">
                  {expanded ? <ChevronDownIcon size={15} /> : <ChevronRightIcon size={15} />}
                </span>
                <span className="composer-activity-card-copy">
                  <strong>{item.title}</strong>
                  {item.summary.trim().length > 0 ? <span>{item.summary}</span> : null}
                </span>
              </span>
            </DisclosureButton>

            <div className={cx('composer-activity-card-body', expanded && 'is-open')}>
              {expanded ? <div className="composer-activity-section-body">{item.content}</div> : null}
            </div>
          </section>
        );
      })}
    </section>
  );
}
