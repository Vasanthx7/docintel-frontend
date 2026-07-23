import ChatApp from "../../ChatApp";

export default function ChatPage({ params }: { params: { id: string } }) {
  return <ChatApp initialConversationId={params.id} />;
}
