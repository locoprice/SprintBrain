import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReviewQueue } from '@/features/review/ReviewQueue';
import { AnswerFeedbackPanel } from '@/features/review/AnswerFeedbackPanel';

const TABS = ['waiting', 'feedback'] as const;

/**
 * Review (AI-KNOWLEDGE P2): the one place for what needs a person. Content
 * waiting for approval, and what people said about Ask SprintBrain answers.
 * ?tab=feedback opens straight on the feedback.
 */
export function ReviewPage() {
  const [params] = useSearchParams();
  const requested = params.get('tab');
  const initialTab = TABS.find((t) => t === requested) ?? 'waiting';

  return (
    <>
      <PageHeader
        title="Review"
        description="Approve what your team wrote, and see what people said about Ask SprintBrain answers."
      />
      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList>
          <TabsTrigger value="waiting">Waiting for approval</TabsTrigger>
          <TabsTrigger value="feedback">Answer feedback</TabsTrigger>
        </TabsList>
        <TabsContent value="waiting">
          <ReviewQueue />
        </TabsContent>
        <TabsContent value="feedback">
          <AnswerFeedbackPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
