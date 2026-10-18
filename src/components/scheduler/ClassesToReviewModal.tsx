import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Eye, UserCheck, Users, X } from 'lucide-react';
import type { ReviewIssue } from './Scheduler.types';
import styles from './ClassesToReviewModal.module.css';

export interface ClassesToReviewModalProps {
  open: boolean;
  issues: ReviewIssue[];
  onClose: () => void;
  /** "View" button, shown only for issues that carry an `eventId` — jumps to and highlights that event (see Scheduler.tsx's handleViewIssueEvent). */
  onViewEvent?: (eventId: string) => void;
  onResolveIssue?: (issueId: string) => void;
  /** "Book" button, shown only for issues that carry a `bookableClass` (a class that was never booked at all) — manually places it on the calendar as a pending placeholder (see Scheduler.tsx's handleBookIssue). The "View matches" list's own per-candidate "Assign" button calls this too, passing that specific candidate as `instructor` — same placement flow, just with the instructor already filled in instead of asking again via PendingBookingActions' own dropdown. */
  onBookIssue?: (bookable: NonNullable<ReviewIssue['bookableClass']>, issueId: string, instructor?: { id: number; name: string }) => void;
}

/**
 * Opened from CreateFab's "Classes to Review" menu item — lists whatever
 * `reviewIssues` the host app currently has (see Scheduler.types.ts's own
 * doc comment on that prop), grouped by `category`. Mirrors
 * InstructorViewDialog's centered backdrop+card shell, the one other
 * "opened from an unrelated global affordance" modal in this component set.
 */
export function ClassesToReviewModal({ open, issues, onClose, onViewEvent, onResolveIssue, onBookIssue }: ClassesToReviewModalProps) {
  // Which issue (if any) currently has its suggested-instructor candidates
  // expanded inline — see buildRoster.ts's own `possibleInstructors` doc
  // comment for where these come from. Purely a local display toggle,
  // doesn't touch `issues` itself.
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReviewIssue[]>();
    for (const issue of issues) {
      const list = map.get(issue.category);
      if (list) list.push(issue);
      else map.set(issue.category, [issue]);
    }
    return Array.from(map.entries());
  }, [issues]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Classes to review"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Classes to review</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <X size={22} />
          </button>
        </div>

        <div className={styles.body}>
          {grouped.length === 0 ? (
            <p className={styles.emptyState}>Nothing to review — every class matched up and scheduled cleanly.</p>
          ) : (
            grouped.map(([category, categoryIssues]) => (
              <section key={category} className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  {category} <span className={styles.countBadge}>{categoryIssues.length}</span>
                </h3>
                <div className={styles.boxList}>
                  {categoryIssues.map((issue) => {
                    const eventId = issue.eventId;
                    const bookable = issue.bookableClass;
                    const suggestedInstructors = bookable?.suggestedInstructors ?? [];
                    const hasSuggestions = suggestedInstructors.length > 0;
                    const isExpanded = expandedIssueId === issue.id;
                    return (
                      <div key={issue.id} className={styles.boxRow}>
                        <div className={styles.boxRowMain}>
                          <div className={styles.issueText}>
                            <span className={styles.issueTitle}>{issue.title}</span>
                            <span className={styles.issueDetail}>{issue.detail}</span>
                          </div>
                          <div className={styles.issueActions}>
                            {eventId && (
                              <button type="button" className={styles.viewButton} onClick={() => onViewEvent?.(eventId)}>
                                <Eye size={14} strokeWidth={2.25} />
                                View
                              </button>
                            )}
                            {hasSuggestions && (
                              <button
                                type="button"
                                className={styles.viewButton}
                                aria-expanded={isExpanded}
                                onClick={() => setExpandedIssueId((current) => (current === issue.id ? null : issue.id))}
                              >
                                <Users size={14} strokeWidth={2.25} />
                                {isExpanded ? 'Hide match' : suggestedInstructors.length === 1 ? 'View match' : 'View matches'}
                              </button>
                            )}
                            {bookable && (
                              <button
                                type="button"
                                className={styles.bookButton}
                                onClick={() => onBookIssue?.(bookable, issue.id)}
                              >
                                <CalendarPlus size={14} strokeWidth={2.25} />
                                Book
                              </button>
                            )}
                            <button type="button" className={styles.resolveButton} onClick={() => onResolveIssue?.(issue.id)}>
                              Resolve
                            </button>
                          </div>
                        </div>
                        {isExpanded && hasSuggestions && bookable && (
                          <div className={styles.suggestedPanel}>
                            <p className={styles.suggestedPanelIntro}>
                              {suggestedInstructors.length === 1
                                ? 'Possible match — a real instructor submitted an Availability Form under a different email, likely the same person:'
                                : `${suggestedInstructors.length} possible matches — each submitted an Availability Form under a different email, and any could be the same person. Their name alone can't tell them apart, so check what each already teaches below before picking one:`}
                            </p>
                            <ul className={styles.suggestedCandidateList}>
                              {suggestedInstructors.map((candidate) => (
                                <li key={candidate.id} className={styles.suggestedCandidateRow}>
                                  <span className={styles.suggestedCandidateText}>
                                    <span className={styles.suggestedCandidateName}>{candidate.name}</span>
                                    <span className={styles.suggestedCandidateMeta}>
                                      {candidate.classes.length > 0 ? `Teaches: ${candidate.classes.join(', ')}` : 'No other classes on file'}
                                    </span>
                                  </span>
                                  <button
                                    type="button"
                                    className={styles.assignButton}
                                    onClick={() => onBookIssue?.(bookable, issue.id, { id: candidate.id, name: candidate.name })}
                                  >
                                    <UserCheck size={13} strokeWidth={2.25} />
                                    Assign
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.footerCloseButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
