'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, BookOpen, Clock, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { findArticle, ARTICLES_BY_CATEGORY } from '../articles';

export default function ArticlePage() {
  const params = useParams();
  const slug = typeof params?.slug === 'string' ? params.slug : '';
  const article = findArticle(slug);

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <BookOpen className="mb-4 h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Article not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The doc page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link
          href="/dashboard/docs"
          className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
        >
          Back to docs
        </Link>
      </div>
    );
  }

  const sameCategory = (ARTICLES_BY_CATEGORY[article.category] ?? []).filter(
    (a) => a.slug !== article.slug,
  );

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_240px]">
      <article className="min-w-0 space-y-3">
        <Link
          href="/dashboard/docs"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All docs
        </Link>
        <div>
          <Badge variant="outline" className="mb-2 text-[10px] uppercase tracking-wide">
            {article.category}
          </Badge>
          <h1 className="text-2xl font-bold tracking-tight">{article.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{article.description}</p>
        </div>
        <div className="flex items-center gap-4 border-b border-border pb-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {article.readTimeMin} min read
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" /> {article.audience}
          </span>
        </div>
        <div className="prose-sm max-w-none">{article.body}</div>
      </article>

      {sameCategory.length > 0 && (
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              More in {article.category}
            </div>
            <ul className="space-y-2">
              {sameCategory.map((a) => (
                <li key={a.slug}>
                  <Link
                    href={`/dashboard/docs/${a.slug}`}
                    className="block rounded-md p-2 text-sm hover:bg-muted"
                  >
                    <div className="font-medium leading-tight">{a.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {a.readTimeMin} min · {a.audience}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}
