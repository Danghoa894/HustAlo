// client/src/features/conversations/ChatListPane.tsx — cột trái /chats (ui_ux_spec.md §3.2): ChatListHeader,
// ConversationSearch, ConversationList; NewChatDialog và CreateGroupDialog. Tab "Cuộc gọi" (SegmentedTabs) thêm ở M5.
import { USER_SEARCH_MIN_QUERY } from '@hustalo/shared';
import { useState } from 'react';
import { CreateGroupDialog } from '../groups/CreateGroupDialog';
import { ChatListHeader } from './ChatListHeader';
import { ConversationList } from './ConversationList';
import { ConversationSearch, SearchResults } from './ConversationSearch';
import { NewChatDialog } from './NewChatDialog';

export function ChatListPane() {
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<'new' | 'group' | null>(null);
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {searching ? (
          <SearchResults
            query={query}
            onDone={() => {
              setQuery('');
            }}
          />
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
