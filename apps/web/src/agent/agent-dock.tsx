import { useEffect, useState, type KeyboardEvent } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { observer, useService } from '@rabjs/react';
import type { AgentMessage, MomentResponse } from '@moment/dto';
import { MessageCircle } from 'lucide-react';
import { AgentDockService, type AgentPageContext } from '@/services/agent-dock.service';
import { AuthService } from '@/services/auth.service';
import { formatHappenedClock } from '@/lib/time';
import { Button } from '@/ui/button/index';
import { TextareaField } from '@/ui/field/index';
import { AlertDialog } from '@/ui/modal/index';
import { AgentMarkdown } from './agent-markdown';

const WIDE_QUERY = '(min-width: 900px)';

const WIDE_PANEL =
  'fixed top-6 right-6 bottom-6 z-floating flex w-full max-w-sheet flex-col rounded-surface-lg bg-surface shadow-fab';
const NARROW_PANEL = 'fixed inset-0 z-floating flex flex-col bg-surface p-4';

const BUSY_COPY = '这条对话正在回答';

function useWideDock(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_QUERY).matches : true,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
}

function usePageContext(): AgentPageContext | undefined {
  const momentMatch = useMatch({ path: '/moments/:momentId', end: true });
  const chainHomeMatch = useMatch({ path: '/chains/:chainId', end: true });
  const recapMatch = useMatch({ path: '/chains/:chainId/recaps/:period', end: true });
  if (momentMatch?.params.momentId) return { momentId: momentMatch.params.momentId };
  if (chainHomeMatch?.params.chainId) return { chainId: chainHomeMatch.params.chainId };
  if (recapMatch?.params.chainId) return { chainId: recapMatch.params.chainId };
  return undefined;
}

function suggestionsFor(context: AgentPageContext | undefined): string[] {
  if (context?.momentId) return ['和这条时刻相关的还有哪些'];
  if (context?.chainId) return ['这条链最近在记什么', '这条链最近的回顾说了什么'];
  return ['最近家里发生了什么', '我加入了哪些链'];
}

function excerpt(moment: MomentResponse): string {
  const raw = moment.content.trim() || (moment.transcript ?? '').trim();
  const flat = raw.replace(/\s+/g, ' ');
  if (flat.length <= 80) return flat;
  return `${flat.slice(0, 80)}…`;
}

function MomentCard({ moment }: { moment: MomentResponse }) {
  const navigate = useNavigate();
  const text = excerpt(moment);
  return (
    <button
      type="button"
      onClick={() => navigate(`/moments/${moment.id}`)}
      className="flex w-full min-w-0 flex-col items-start gap-1 rounded-surface-md bg-bg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset"
    >
      <span className="text-meta font-semibold text-ink">{moment.author.nickname}</span>
      {text ? <span className="text-body text-ink">{text}</span> : null}
      <span className="text-caption text-muted">
        {formatHappenedClock(moment.happenedAt, moment.happenedTzOffset)}
      </span>
    </button>
  );
}

function MessageView({ message }: { message: AgentMessage }) {
  if (message.role === 'user') {
    return <p className="whitespace-pre-wrap text-body text-ink">{message.content}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {message.content ? <AgentMarkdown content={message.content} /> : null}
      {message.moments.map((moment) => (
        <MomentCard key={moment.id} moment={moment} />
      ))}
    </div>
  );
}

/** 侧栏与窄屏顶栏的入口。不是第二枚浮动按钮。 */
export const AgentDockEntry = observer(function AgentDockEntry({ block = false }: { block?: boolean }) {
  const auth = useService(AuthService);
  const dock = useService(AgentDockService);
  if (!auth.user) return null;
  return (
    <Button
      variant="quiet"
      className={block ? 'w-full' : ''}
      aria-expanded={dock.open}
      leadingIcon={MessageCircle}
      onClick={() => dock.toggle()}
    >
      问问时刻
    </Button>
  );
});

/** 始终挂着，这样收起后面板卸载也不会丢掉一次跳转。 */
export const AgentDockNav = observer(function AgentDockNav() {
  const dock = useService(AgentDockService);
  const navigate = useNavigate();
  const pendingNav = dock.pendingNav;
  useEffect(() => {
    if (!pendingNav) return;
    dock.ackNav();
    if (pendingNav.target === 'moment') navigate(`/moments/${pendingNav.momentId}`);
    else if (pendingNav.target === 'chain') navigate(`/chains/${pendingNav.chainId}`);
    else navigate(`/chains/${pendingNav.chainId}/recaps/${pendingNav.period}`);
  }, [pendingNav, dock, navigate]);
  return null;
});

/** 打开时盖住发布按钮；收起后卸载，发布按钮重新可见。 */
export const AgentDockPanel = observer(function AgentDockPanel() {
  const dock = useService(AgentDockService);
  const wide = useWideDock();
  const context = usePageContext();
  const [history, setHistory] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const answering = dock.streaming || dock.error === BUSY_COPY;
  const title = dock.threads.find((item) => item.id === dock.threadId)?.title ?? '新的对话';

  useEffect(() => {
    void dock.loadOnOpen();
  }, [dock]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (dock.streaming) return;
    void dock.send(dock.draft, context);
  };

  return (
    <section role="region" aria-label="问问时刻" className={wide ? WIDE_PANEL : NARROW_PANEL}>
      <div className={`flex min-h-0 flex-1 flex-col gap-4 overflow-hidden ${wide ? 'p-4' : ''}`}>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-body font-semibold text-ink">{title}</h2>
          <Button
            variant="quiet"
            disabled={dock.streaming}
            onClick={() => {
              dock.startNew();
              setHistory(false);
            }}
          >
            新对话
          </Button>
          <Button variant="quiet" aria-pressed={history} onClick={() => setHistory((open) => !open)}>
            历史
          </Button>
          <Button variant="quiet" onClick={() => dock.close()}>
            收起
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {history ? (
            <div className="flex flex-col gap-2">
              {dock.streaming ? <p className="text-meta text-muted">{BUSY_COPY}</p> : null}
              {dock.threads.length === 0 ? <p className="text-meta text-muted">还没有对话</p> : null}
              <ul className="flex flex-col gap-2">
                {dock.threads.map((thread) => (
                  <li key={thread.id} className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={dock.streaming}
                      onClick={() => {
                        void dock.selectThread(thread.id);
                        setHistory(false);
                      }}
                      className="min-w-0 flex-1 truncate rounded-menu-item px-2 py-2 text-left text-body text-ink focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-inset disabled:opacity-button-disabled"
                    >
                      {thread.title}
                    </button>
                    <Button variant="quiet" disabled={answering} onClick={() => setPendingDelete(thread.id)}>
                      删除
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {dock.messages.map((message) => (
                <MessageView key={message.id} message={message} />
              ))}
              {dock.streaming && (dock.liveContent || dock.liveMoments.length > 0) ? (
                <div className="flex flex-col gap-2">
                  {dock.liveContent ? <AgentMarkdown content={dock.liveContent} /> : null}
                  {dock.liveMoments.map((moment) => (
                    <MomentCard key={moment.id} moment={moment} />
                  ))}
                </div>
              ) : null}
              {dock.messages.length === 0 && !dock.streaming
                ? suggestionsFor(context).map((text) => (
                    <Button key={text} variant="quiet" onClick={() => void dock.send(text, context)}>
                      {text}
                    </Button>
                  ))
                : null}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          {dock.statusText ? (
            <p role="status" className="text-meta text-muted">
              {dock.statusText}
            </p>
          ) : null}
          {dock.error ? (
            <p role="alert" className="text-meta text-danger">
              {dock.error}
            </p>
          ) : null}
          <div onKeyDownCapture={onKeyDown}>
            <TextareaField
              label="问一句"
              name="agent-draft"
              value={dock.draft}
              onChange={(value) => {
                dock.draft = value;
              }}
              placeholder="想问什么"
              minRows={2}
              maxLength={2000}
              description={dock.unavailable ? '助手还没接上' : undefined}
            />
          </div>
          <div className="flex justify-end">
            {dock.streaming ? (
              <Button variant="primary" onClick={() => dock.stop()}>
                停止
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!dock.draft.trim()}
                onClick={() => void dock.send(dock.draft, context)}
              >
                发送
              </Button>
            )}
          </div>
        </div>
      </div>
      <AlertDialog
        open={pendingDelete !== null}
        title="删除这条对话"
        body="删掉之后不能恢复。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        busy={dock.streaming}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete || dock.streaming) return;
          const id = pendingDelete;
          setPendingDelete(null);
          void dock.deleteThread(id);
        }}
      />
    </section>
  );
});
