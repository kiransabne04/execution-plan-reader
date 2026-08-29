// Episode 18, Story 18.13, spec §5 `2c` — a small, editorially-distinct
// panel linking to related @scalingbackend content. Visually apart from
// the pgsuite/QueryDoc funnel callout (FunnelCallout.tsx, teal, a product
// nudge): neutral styling here, and the two are never rendered stacked
// adjacent in the same panel — see DetailPanel.tsx's own placement
// comment for how that's structurally guaranteed, not just visual
// convention.

import { matchContentPosts } from "./matchContentPosts"
import { POSTS } from "./posts"
import "./contentStack.css"

export interface ContentStackProps {
  operatorType: string
  ruleIds: string[]
}

const KIND_LABEL: Record<"blog" | "video", string> = {
  blog: "Read",
  video: "Watch",
}

/** Renders nothing (not an empty-but-visible container) whenever there's
 * no match — including, today, always, since the real `posts.ts` ships
 * with zero entries. */
export function ContentStack({ operatorType, ruleIds }: ContentStackProps) {
  const matches = matchContentPosts(POSTS, operatorType, ruleIds)
  if (matches.length === 0) return null

  return (
    <section className="content-stack" data-testid="content-stack" aria-label="Related content">
      <h3 className="content-stack__heading">Related from @scalingbackend</h3>
      <ul className="content-stack__list">
        {matches.map((post) => (
          <li key={post.id}>
            {/* Spec §5 `2c`: new tab, `rel="noopener"`, no click-tracking
                beacon anywhere in this component — that would breach the
                no-network-call guarantee (privacy-architecture skill) the
                same as any other outbound request would. */}
            <a href={post.url} target="_blank" rel="noopener noreferrer" className="content-stack__link" data-testid="content-stack-link">
              <span className="content-stack__kind">{KIND_LABEL[post.kind]}</span>
              <span className="content-stack__title">{post.title}</span>
              <span className="content-stack__minutes">{post.minutes} min</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
