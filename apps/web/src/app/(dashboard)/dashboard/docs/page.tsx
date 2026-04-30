'use client';

/**
 * In-app documentation index. Lists every article grouped by category.
 *
 * Articles live in `articles.tsx` (typed objects with JSX bodies — no MDX
 * runtime, no markdown parsing). Add an entry there to surface a new
 * article here automatically.
 */

import * as React from 'react';
import Link from 'next/link';
import { BookOpen, Clock, Users, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ARTICLES_BY_CATEGORY, type Category } from './articles';

const CATEGORY_ORDER: Category[] = ['Pay Equity', 'Comp Cycles', 'Letters', 'Platform'];

const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  'Pay Equity':
    'Auditor-defensible pay-gap analysis with AI narrative, statutory exports, and a manager copilot.',
  'Comp Cycles':
    'Plan, calibrate, and close compensation cycles with letters, manager workflows, and writeback.',
  Letters:
    'AI-generated compensation letters with multi-step approval, batch generation, and email delivery.',
  Platform: 'Permissions, integrations, audit trail, and shared infrastructure.',
};

export default function DocsIndexPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Docs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How each feature works and the logic behind it. Written for the people who build,
            operate, and audit Compport.
          </p>
        </div>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const articles = ARTICLES_BY_CATEGORY[cat];
        if (!articles || articles.length === 0) return null;
        return (
          <section key={cat} className="space-y-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">{cat}</h2>
              <p className="text-xs text-muted-foreground">{CATEGORY_DESCRIPTIONS[cat]}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map((a) => (
                <Link key={a.slug} href={`/dashboard/docs/${a.slug}`} className="group block">
                  <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-muted/30">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base leading-tight">{a.title}</CardTitle>
                      <CardDescription className="text-xs">{a.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between pt-0">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {a.readTimeMin} min
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" /> {a.audience}
                        </span>
                      </div>
                      <Badge
                        variant="outline"
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </Badge>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <Card className="border-dashed">
        <CardContent className="py-4 text-xs text-muted-foreground">
          <strong className="text-foreground">More to come:</strong> deeper articles for Comp
          Cycles, Letters, and Platform are next. Suggest topics or report errors via the in-product
          feedback channel.
        </CardContent>
      </Card>
    </div>
  );
}
