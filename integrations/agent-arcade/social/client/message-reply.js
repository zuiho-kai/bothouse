// Native DOM port of Bothouse ChannelsPage.Quote and Tinode handleQuoteClick.
// The server supplies a viewer-scoped preview. See THIRD_PARTY_NOTICES.md.
export function quoteControl(quote, locate) {
  if(quote.unavailable){
    const label=document.createElement('p');
    label.className='message-quote minor';
    label.textContent='原消息已移除或不可查看';
    return label;
  }
  const control=document.createElement('button');
  control.type='button';
  control.className='message-quote';
  const author=document.createElement('strong');
  author.textContent=quote.name;
  control.append(author,document.createTextNode(quote.text));
  control.title='定位原消息';
  control.addEventListener('click',()=>locate(quote.id));
  return control;
}

export function focusOriginal(target) {
  if(!target)return;
  target.scrollIntoView({block:'center',behavior:'instant'});
  target.focus({preventScroll:true});
}
