// Episode 18, Story 18.13, spec §5 `2c` — a small, editorially-distinct
// panel linking to related @scalingbackend content. Visually apart from
// the pgsuite/QueryDoc funnel callout (FunnelCallout.tsx, teal, a product
// nudge): neutral styling here, and the two are never rendered stacked
// adjacent in the same panel — see DetailPanel.tsx's own placement
// comment for how that's structurally guaranteed, not just visual
// convention.

import { Article, PlayCircle } from "@phosphor-icons/react"
import { operatorIconKey, type OperatorIconKey } from "../operatorIcons"
import { matchContentPosts } from "./matchContentPosts"
import { POSTS, type ContentPost } from "./posts"
import "./contentStack.css"

export interface ContentStackProps {
  operatorType: string
  ruleIds: string[]
}

// Design review (reference mock) — "GO DEEPER ON JOINS" rather than a
// fixed "Related from @scalingbackend": the heading names the operator's
// own topic, reusing `operatorIconKey`'s existing categorization (one
// classification, not a second one invented just for this heading).
// "Unknown" has no natural plural topic name, so it falls back to the
// original generic wording rather than reading as "Go deeper on
// unknowns".
const TOPIC_LABEL: Partial<Record<OperatorIconKey, string>> = {
  limit: "limits",
  aggregate: "aggregates",
  sort: "sorting",
  join: "joins",
  scan: "scans",
  hash: "hashing",
  index: "index scans",
}

const KIND_LABEL: Record<ContentPost["kind"], string> = {
  blog: "Blog",
  video: "Video",
}

const KIND_ICON: Record<ContentPost["kind"], typeof Article> = {
  blog: Article,
  video: PlayCircle,
}

/** "7 min read" for a blog post, "12 min" for a video — same distinction
 * the reference mock itself makes (an article is something you read, a
 * video isn't described that way). */
function durationLabel(post: ContentPost): string {
  return post.kind === "blog" ? `${post.minutes} min read` : `${post.minutes} min`
}

/** Renders nothing (not an empty-but-visible container) whenever there's
 * no match — including, today, always, since the real `posts.ts` ships
 * with zero entries. */
export function ContentStack({ operatorType, ruleIds }: ContentStackProps) {
  const matches = matchContentPosts(POSTS, operatorType, ruleIds)
  if (matches.length === 0) return null

  const topic = TOPIC_LABEL[operatorIconKey(operatorType)]
  const heading = topic ? `Go deeper on ${topic}` : "Related from @scalingbackend"

  return (
    <section className="content-stack" data-testid="content-stack" aria-label="Related content">
      <div className="content-stack__header">
        <h3 className="content-stack__heading">{heading}</h3>
        <span className="content-stack__from">from the series</span>
      </div>
      <ul className="content-stack__list">
        {matches.map((post) => {
          const Icon = KIND_ICON[post.kind]
          return (
            <li key={post.id}>
              {/* Spec §5 `2c`: new tab, `rel="noopener"`, no click-tracking
                  beacon anywhere in this component — that would breach the
                  no-network-call guarantee (privacy-architecture skill) the
                  same as any other outbound request would. */}
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="content-stack__link"
                data-testid="content-stack-link"
              >
                <Icon className="content-stack__icon" weight="regular" aria-hidden="true" />
                <span className="content-stack__body">
                  <span className="content-stack__title">{post.title}</span>
                  <span className="content-stack__meta">
                    {KIND_LABEL[post.kind]} · {durationLabel(post)}
                  </span>
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
