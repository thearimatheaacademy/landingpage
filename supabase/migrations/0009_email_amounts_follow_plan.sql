-- Apply AFTER the Worker that understands {{payment_summary}} and {{amount_due_now}} is live (instalments release).
update public.email_sequence_steps
  set html = replace(html, 'your payment of £150 has been received', '{{payment_summary}}')
  where html like '%your payment of £150 has been received%';
update public.email_sequence_steps
  set html = replace(replace(html, 'COMPLETE PAYMENT (£150)', 'COMPLETE PAYMENT ({{amount_due_now}})'), 'SECURE YOUR PLACE (£150)', 'SECURE YOUR PLACE ({{amount_due_now}})')
  where audience = 'pending';
