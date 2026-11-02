// client/src/features/conversations/ChatListPane.tsx — cột trái /chats (ui_ux_spec.md §3.2): ChatListHeader,
// ConversationSearch, SegmentedTabs "Trò chuyện" | "Cuộc gọi" (M5), ConversationList / CallHistoryList; NewChatDialog và
// CreateGroupDialog.
import { USER_SEARCH_MIN_QUERY } from '@hustalo/shared';
import { useState } from 'react';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { vi } from '../../i18n/vi';
import { CallHistoryList } from '../calls/CallHistoryList';
import { CreateGroupDialog } from '../groups/CreateGroupDialog';
import { ChatListHeader } from './ChatListHeader';
import { ConversationList } from './ConversationList';
import { ConversationSearch, SearchResults } from './ConversationSearch';
import { NewChatDialog } from './NewChatDialog';

export function ChatListPane() {
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<'new' | 'group' | null>(null);
  const [tab, setTab] = useState<'chats' | 'calls'>('chats');
  const searching = query.trim().length >= USER_SEARCH_MIN_QUERY;
  const openNew = () => {
    setDialog('new');
  };
  const close = () => {
    setDialog(null);
  };

  return (
    <div className="flex h-full flex-col">
      <ChatListHeader onNewChat={openNew} />
      <ConversationSearch value={query} onChange={setQuery} />
      {searching ? null : (
        <SegmentedTabs
          label={vi.calls.tabCalls}
          tabs={[
            { id: 'chats', label: vi.calls.tabChats },
            { id: 'calls', label: vi.calls.tabCalls },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {searching ? (
          <SearchResults
            query={query}
            onDone={() => {
              setQuery('');
            }}
          />
        ) : tab === 'calls' ? (
          <CallHistoryList />
        ) : (
          <ConversationList onStartChat={openNew} />
        )}
      </div>
      <NewChatDialog
        open={dialog === 'new'}
        onClose={close}
        onCreateGroup={() => {
          setDialog('group');
        }}
      />
      {dialog === 'group' ? <CreateGroupDialog onClose={close} /> : null}
    </div>
  );
}
