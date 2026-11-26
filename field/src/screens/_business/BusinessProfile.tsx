import { useState, type ReactNode } from 'react';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, EmptyState, HeroCard, Icon, IconTile, ListRow, LoadingState, SendLinkButtons, StatusChip, Text, type IconName, type SendChannel } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import { errorCode, type BusinessNextStep, type BusinessPage, type BusinessPageDetails, type HistoryEntry, type PageVisit } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { pageRoutes, routes } from '@/navigation/routes';
import { useSellingRoutes } from '@/navigation/useFlow';
import { colors, fonts, radius } from '@/theme';
import { istDateKey, minutesOf } from '../_visits/format';
import { outcomeKey, verificationKey } from '../_visits/labels';
import { VacancyStep } from './VacancyStep';
import { ShiftsCard } from './Shifts';
import { BusinessRowEnd, businessStatusText } from '../FA09-MyBusinesses';
import { roleKey } from '../FA18-CallOwner';

const HIDDEN_KEYS: Record<string, MessageKey> = {
  suspended: 'biz.hidden.suspended',
  paused: 'biz.hidden.paused',
  agreement_not_signed: 'biz.hidden.agreement_not_signed',
  visit_outside_area: 'biz.hidden.visit_outside_area',
  not_verified: 'biz.hidden.not_verified',
};

/** "What this business needs next", one line in the agent's language. */
export function nextStepText(step: BusinessNextStep, t: (key: MessageKey) => string): string {
  switch (step.kind) {
    case 'agreement_waiting':
      return t(step.agreementState === 'link_expired' ? 'biz.next.agreement_expired' : step.agreementState === 'not_sent' ? 'biz.next.agreement_not_sent' : 'biz.next.agreement_waiting');
    case 'candidates_hidden':
      return t(step.reason === 'visit_outside_area' ? 'biz.hidden.visit_outside_area' : 'biz.hidden.not_verified');
    default:
      return t(`biz.next.${step.kind}` as MessageKey);
  }
}

type Tab = 'visit' | 'work' | 'details' | 'photos' | 'history';

/**
 * The one business profile (owner, 27 Nov): the same screen whether it is opened from the
 * Visits tab (a visit of this business) or the Businesses tab. On top, without scrolling: the
 * name, type, area and status; whom to call; four quick buttons (Call, Visit, + Vacancy, Map);
 * the onboarding steps as small tiles; "Where it's stuck" with its one button; the numbers.
 * Below, tabs: This visit (only when opened from a visit), Work (vacancies, shifts, candidates
 * and interviews), Details (address, people, business, documents, how it joined), Photos (from
 * the agent's own visits) and History. A business that is not the agent's own is view-only.
 * Data: GET /field-work/businesses/:id/page.
 */
export function BusinessProfile({ b, visitCard }: { b: BusinessPage; visitCard?: ReactNode }) {
  const { t } = useI18n();
  const [today] = useState(() => istDateKey(Date.now()));
  const [tab, setTab] = useState<Tab>(visitCard ? 'visit' : 'work');
  const verified = b.status.verificationStatus === 'verified' && !b.status.paused && !b.status.suspended;
  const typeLabel = b.businessType === 'other' && b.details?.businessTypeOther ? b.details.businessTypeOther : b.businessType ? t(`btype.${b.businessType}` as 'btype.other') : null;
  const contactLine = b.contact?.phoneLast4
    ? [b.contact.name, b.contact.role ? t(roleKey(b.contact.role)) : null, `******${b.contact.phoneLast4}`].filter(Boolean).join(' · ')
    : null;
  const openVacancies = b.vacancies.filter((v) => v.status === 'open').reduce((sum, v) => sum + v.headcount, 0);
  const tabs: Tab[] = [...(visitCard ? (['visit'] as Tab[]) : []), 'work', 'details', 'photos', 'history'];
  return (
    <>
      <HeroCard
        title={b.name}
        subtitle={[typeLabel, b.locality, b.code].filter(Boolean).join(' · ')}
        corner={<StatusChip tone={verified ? 'green' : 'amber'} label={b.status.suspended ? t('biz.suspended') : t(verificationKey(b.status.verificationStatus, b.status.paused))} />}
        testID="fa08-hero"
      >
        <View style={styles.heroLines}>
          {contactLine ? (
            <View style={styles.heroLine} testID="fa08-contact">
              <Icon name="phone" size={15} color={colors.onBlueSoft} />
              <Text style={styles.heroText} numberOfLines={1}>{contactLine}</Text>
            </View>
          ) : null}
          <View style={styles.heroLine} testID="fa08-agent">
            <Icon name="user" size={15} color={colors.onBlueSoft} />
            <Text style={styles.heroText} numberOfLines={1}>
              {b.accountAgent ? (b.accountAgent.isMe ? t('bp.agentMe') : t('bp.agentOther', { name: b.accountAgent.name })) : t('biz.noAccountAgent')}
            </Text>
          </View>
        </View>
      </HeroCard>

      {b.canAct ? <QuickActions b={b} /> : <Banner tone="info" title={t('biz.viewOnly')} message={t('biz.viewOnlyBody')} testID="fa08-view-only" />}

      <Onboarding b={b} />

      {b.canAct && b.row ? <StuckBox b={b} /> : null}

      <View style={styles.numbers} testID="fa08-numbers">
        <Num value={openVacancies} label={t('bp.num.vacancies')} onPress={() => setTab('work')} testID="fa08-num-vacancies" />
        <Num value={b.candidates.shown} label={t('bp.num.shown')} onPress={() => setTab('work')} testID="fa08-num-shown" />
        <Num value={b.candidates.interviews.total} label={t('bp.num.interviews')} onPress={() => setTab('work')} testID="fa08-num-interviews" />
        <Num value={b.candidates.placements} label={t('bp.num.placed')} onPress={() => setTab('work')} testID="fa08-num-placed" />
      </View>

      <View style={styles.tabs} accessibilityRole="tablist" testID="fa08-tabs">
        {tabs.map((k) => {
          const on = k === tab;
          return (
            <Pressable
              key={k}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setTab(k)}
              style={[styles.tab, on && styles.tabOn]}
              testID={`fa08-tab-${k}`}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t(`bp.tab.${k}` as MessageKey)}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'visit' ? visitCard : null}
      {tab === 'work' ? <Work b={b} today={today} /> : null}
      {tab === 'details' ? <Details b={b} /> : null}
      {tab === 'photos' ? <Photos visits={b.visits} /> : null}
      {tab === 'history' ? <History b={b} today={today} /> : null}
    </>
  );
}

function QuickActions({ b }: { b: BusinessPage }) {
  const { t } = useI18n();
  const sr = useSellingRoutes();
  const mapUrl = mapLink(b);
  return (
    <View style={styles.quick}>
      <Quick icon="phone" label={t('bp.act.call')} disabled={!b.actions.callOwner} onPress={() => router.push(sr.callOwner(b.id))} testID="fa08-call" />
      <Quick
        icon="camera"
        label={t('bp.act.visit')}
        disabled={!b.actions.recordVisit}
        onPress={() => router.push({ pathname: routes.visitStart, params: { businessId: b.id, name: b.name } })}
        testID="fa08-visit"
      />
      <Quick icon="briefcase" label={t('bp.act.vacancy')} disabled={!b.actions.addVacancy} onPress={() => router.push(sr.addVacancy(b.id))} testID="fa08-vacancy" />
      <Quick icon="map" label={t('bp.act.map')} disabled={!mapUrl} onPress={() => mapUrl && void Linking.openURL(mapUrl)} testID="fa08-map" />
    </View>
  );
}

/** The business's own Maps link, else its pin. */
export function mapLink(b: Pick<BusinessPage, 'latitude' | 'longitude' | 'details'>): string | null {
  if (b.details?.map.mapsLink) return b.details.map.mapsLink;
  const lat = b.details?.map.latitude ?? b.latitude;
  const lng = b.details?.map.longitude ?? b.longitude;
  return lat !== null && lat !== undefined && lng !== null && lng !== undefined ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null;
}

function Quick({ icon, label, onPress, disabled, testID }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; testID: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.quickBtn, disabled && styles.quickOff, pressed && styles.pressed]}
      testID={testID}
    >
      <Icon name={icon} size={20} color={disabled ? colors.faint : colors.blue} />
      <Text style={[styles.quickText, disabled && { color: colors.faint }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Num({ value, label, onPress, testID }: { value: number; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${value} ${label}`} onPress={onPress} style={({ pressed }) => [styles.num, pressed && styles.pressed]} testID={testID}>
      <Text style={styles.numValue}>{String(value)}</Text>
      <Text style={styles.numLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/**
 * "Where it's stuck" (Laboura Field lists, 22 Nov evening), as on the Team Lead's and CEO's
 * profiles: the business's one plain status and its next-step button (the same as its row
 * in My businesses), "Waiting" while the Team Lead checks, or "All done".
 */
function StuckBox({ b }: { b: BusinessPage }) {
  const { t } = useI18n();
  const row = b.row!;
  if (row.done && !row.action) return <Banner tone="ok" title={t('fa08.allDone')} message={businessStatusText(row, t)} testID="fa08-all-done" />;
  return (
    <View style={styles.stuck} testID="fa08-stuck">
      <View style={styles.flex1}>
        <Text variant="tiny">{t('fa08.stuck')}</Text>
        <Text variant="bodyStrong" testID="fa08-stuck-status">{businessStatusText(row, t)}</Text>
      </View>
      <BusinessRowEnd b={b} row={row} testPrefix="fa08" />
    </View>
  );
}

/** Registered · owner's phone confirmed · agreement (or Resend link) · Team Lead check, as four small tiles. */
function Onboarding({ b }: { b: BusinessPage }) {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const a = b.checklist.agreement;
  // Rev 211: "Send on WhatsApp" (SMS as backup) or the small "Send by SMS".
  const resend = useMutation({
    mutationFn: (channel: SendChannel) => queue.live(() => redesign.resendAgreement(b.id, channel)),
    onSettled: () => void client.invalidateQueries({ queryKey: ['field-work'] }),
  });
  const tl = b.checklist.teamLeadCheck.state;
  const phoneDone = b.checklist.ownerPhoneVerified.done;
  const resendCode = resend.error ? errorCode(resend.error) : null;
  return (
    <View style={styles.steps} testID="fa08-checklist">
      <View style={styles.stepRow}>
        <Step
          ok
          label={t('biz.check.registered')}
          value={b.checklist.registered.at ? formatDayIst(b.checklist.registered.at) : t('fa06.done')}
          testID="fa08-check-registered"
        />
        <Step ok={phoneDone} label={t('bp.mobile')} value={phoneDone ? t('fa06.done') : t('biz.notYet')} testID="fa08-check-phone" />
      </View>
      <View style={styles.stepRow}>
        <Step
          ok={a.state === 'signed'}
          warn={a.state !== 'signed' && a.state !== 'link_sent'}
          label={t('biz.check.agreement')}
          note={a.state !== 'signed' && a.linkSentAt ? t('fa07b.linkSent', { last4: a.sentToLast4 ?? '—', time: formatTimeIst(a.linkSentAt) }) : undefined}
          value={a.state === 'signed' ? (a.signedAt ? t('fa06b.signedAt', { time: formatDayIst(a.signedAt) }) : t('fa07b.signed')) : t(`fa07b.state.${a.state}` as MessageKey)}
          testID="fa08-check-agreement"
        />
        <Step ok={tl === 'done'} label={t('biz.check.teamLead')} value={t(`biz.tl.${tl}` as MessageKey)} testID="fa08-check-tl" />
      </View>
      {b.actions.resendAgreement ? (
        <>
          <SendLinkButtons
            label={resend.isSuccess ? t('fa07b.resent', { last4: resend.data.sentToLast4 }) : t('fa07b.resend')}
            disabled={resend.isSuccess || a.canResend === false || resend.isPending}
            run={(channel) => resend.mutateAsync(channel)}
            onError={() => undefined}
            testID="fa08-resend"
          />
          {resend.error ? (
            <Banner
              tone="error"
              message={resendCode === 'AGREEMENT_SMS_FAILED' ? t('fa07b.err.smsFailed') : resendCode?.startsWith('AGREEMENT_RESEND') ? t('fa07b.err.tooSoonNoTime') : isApiError(resend.error) ? resend.error.message : t('common.error')}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function Step({ ok, warn, label, value, note, testID }: { ok: boolean; warn?: boolean; label: string; value: string; note?: string; testID: string }) {
  const tone = ok ? styles.stepOk : warn ? styles.stepWarn : styles.stepWait;
  return (
    <View style={[styles.step, tone]} testID={testID}>
      <View style={styles.stepHead}>
        <Icon name={ok ? 'check-circle' : 'clock'} size={15} color={ok ? colors.greenText : warn ? colors.crit : colors.amber} />
        <Text style={styles.stepLabel} numberOfLines={1}>{label}</Text>
      </View>
      {note ? <Text variant="tiny">{note}</Text> : null}
      <Text style={[styles.stepValue, { color: ok ? colors.greenText : warn ? colors.crit : colors.amber }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Vacancies (each with its one next step) and + Vacancy, shifts, candidates and interviews. */
function Work({ b, today }: { b: BusinessPage; today: string }) {
  const { t } = useI18n();
  const sr = useSellingRoutes();
  return (
    <>
      <Card title={t('biz.vacancies')} icon="briefcase" accent="orange" testID="fa08-vacancies">
        {b.vacancies.length === 0 ? <EmptyState compact emoji="🧑‍🍳" message={t('biz.noVacancies')} /> : null}
        {b.vacancies.map((v, i) => (
          <VacancyStep key={v.id} vacancy={v} businessId={b.id} sr={sr} canAct={b.canAct} last={i === b.vacancies.length - 1} />
        ))}
        {b.actions.addVacancy ? (
          <Button label={t('fa03.addVacancy')} variant="secondary" onPress={() => router.push(sr.addVacancy(b.id))} testID="fa08-add-vacancy" />
        ) : null}
      </Card>

      <Card title={t('biz.candidates')} icon="users" accent="cyan" testID="fa08-candidates">
        {!b.status.canShowCandidates && b.status.candidatesHiddenReason ? (
          <Banner tone="info" plain message={t(HIDDEN_KEYS[b.status.candidatesHiddenReason] ?? 'biz.hidden.not_verified')} testID="fa08-hidden" />
        ) : null}
        <ListRow
          title={t('fa08.shown')}
          leading={<IconTile icon="users" accent="cyan" size={30} />}
          trailing={<Text variant="bodyStrong">{b.candidates.shownByMe !== b.candidates.shown ? `${b.candidates.shown} · ${t('biz.byYou', { count: b.candidates.shownByMe })}` : String(b.candidates.shown)}</Text>}
        />
        <ListRow
          title={t('fa08.interviews')}
          leading={<IconTile icon="calendar" accent="gold" size={30} />}
          trailing={<Text variant="bodyStrong">{t('biz.interviewCounts', { total: b.candidates.interviews.total, today: b.candidates.interviews.today, upcoming: b.candidates.interviews.upcoming })}</Text>}
        />
        <ListRow
          title={t('fa08.placements')}
          leading={<IconTile icon="trophy" accent="green" size={30} />}
          trailing={<Text variant="bodyStrong">{b.candidates.inGuarantee > 0 ? `${b.candidates.placements} · ${t('fa08.inGuarantee', { count: b.candidates.inGuarantee })}` : String(b.candidates.placements)}</Text>}
          last={b.candidates.recentInterviews.length === 0}
        />
        {b.candidates.recentInterviews.map((iv, i, all) => {
          const isToday = istDateKey(iv.startsAt) === today;
          return (
            <ListRow
              key={iv.id}
              title={`${iv.candidateName} · ${isToday ? `${t('date.today')} ${formatTimeIst(iv.startsAt)}` : formatDayIst(iv.startsAt)}`}
              subtitle={iv.code}
              leading={<IconTile icon="calendar" accent={isToday ? 'royal' : 'navy'} size={30} />}
              trailing={<StatusChip tone={iv.result === 'selected' ? 'green' : iv.result ? 'neutral' : 'blue'} label={iv.result ? t(`result.${iv.result}` as MessageKey) : t('biz.interviewOpen')} />}
              onPress={b.canAct ? () => router.push(isToday ? sr.interviewDay(iv.id) : sr.booked(iv.id)) : undefined}
              last={i === all.length - 1}
              testID={`fa08-interview-${iv.id}`}
            />
          );
        })}
        {b.actions.showCandidates ? (
          <Button label={t('fa08.showCandidates')} icon={<Icon name="users" color={colors.white} />} onPress={() => router.push(sr.matches(b.id))} testID="fa08-show" />
        ) : null}
      </Card>

      <ShiftsCard businessId={b.id} canEdit={b.canAct} />
    </>
  );
}

/** One "label · value" line of the Details tab; nothing when the value is empty. */
function Fact({ label, value, testID }: { label: string; value: string | null | undefined; testID?: string }) {
  if (!value) return null;
  return (
    <View style={styles.fact} testID={testID}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const DOC_ORDER = ['gst', 'fssai', 'trade', 'shopEst', 'udyam'] as const;

function Details({ b }: { b: BusinessPage }) {
  const { t } = useI18n();
  const d: BusinessPageDetails | undefined = b.details;
  const mapUrl = mapLink(b);
  if (!d) return <EmptyState compact message={t('common.error')} />;
  const a = d.address;
  const street = [a.shopNumber, a.street].filter(Boolean).join(', ');
  const place = [a.locality, a.city, a.pincode].filter(Boolean).join(', ');
  const docs: Record<(typeof DOC_ORDER)[number], string | null> = {
    gst: d.documents.gst ? `${d.documents.gst.number}${d.documents.gst.verified ? ` · ${t('bp.gstVerified')}` : ''}` : null,
    fssai: d.documents.fssai,
    trade: d.documents.tradeLicence,
    shopEst: d.documents.shopEstablishment,
    udyam: d.documents.udyam,
  };
  const anyDoc = DOC_ORDER.some((k) => docs[k]) || d.documents.panLast4 || d.documents.others.length > 0;
  const typeLabel = b.businessType === 'other' && d.businessTypeOther ? d.businessTypeOther : b.businessType ? t(`btype.${b.businessType}` as 'btype.other') : null;
  return (
    <>
      <Card title={t('bp.address')} icon="location" accent="royal" testID="fa08-address">
        {street || place || a.full ? (
          <>
            <Fact label={t('bp.street')} value={street || null} />
            <Fact label={t('bp.landmark')} value={a.landmark} />
            <Fact label={t('bp.area')} value={place || null} />
            {!street && !place ? <Text>{a.full}</Text> : null}
          </>
        ) : (
          <Text variant="muted">{t('bp.address.none')}</Text>
        )}
        {a.runsFromHome ? <Text variant="small">{t('bp.address.home')}</Text> : null}
        {d.map.placeName ? <Text variant="small">📍 {d.map.placeName}</Text> : null}
        {mapUrl ? <Button label={t('bp.openMap')} variant="secondary" icon={<Icon name="map" color={colors.blue} />} onPress={() => void Linking.openURL(mapUrl)} testID="fa08-open-map" /> : null}
      </Card>

      <Card title={t('bp.people')} icon="users" accent="green" testID="fa08-people">
        <Fact label={t('bp.contactPerson')} value={[d.people.contactName, d.people.contactRole ? t(roleKey(d.people.contactRole)) : null].filter(Boolean).join(' · ') || null} />
        <Fact label={t('bp.mobile')} value={d.people.phoneLast4 ? `******${d.people.phoneLast4}${d.people.phoneVerified ? ` · ${t('bp.mobileVerified')}` : ''}` : null} />
        <Fact label={t('bp.whatsapp')} value={d.people.whatsappLast4 ? `******${d.people.whatsappLast4}` : null} />
        <Fact label={t('bp.otherNumber')} value={d.people.otherContactLast4 ? `******${d.people.otherContactLast4}` : null} />
        <Fact label={t('bp.owner')} value={d.people.ownerName} />
        <Fact label={t('bp.legalName')} value={d.people.legalName} />
        <Fact label={t('bp.accountAgent')} value={b.accountAgent ? (b.accountAgent.isMe ? t('bp.agentMe') : `${b.accountAgent.name} · ${b.accountAgent.code}`) : t('biz.noAccountAgent')} />
      </Card>

      <Card title={t('bp.business')} icon="store" accent="orange" testID="fa08-business">
        <Fact label={t('bp.type')} value={typeLabel} />
        <Fact label={t('bp.staffCount')} value={d.staff.employeeCount !== null ? String(d.staff.employeeCount) : d.staff.employeeCountBand?.replace('-', '–')} />
        <Fact label={t('bp.staffNeeded')} value={d.staff.staffNeeded.length ? d.staff.staffNeeded.join(', ') : null} />
        {d.branches.length ? (
          <>
            <Text variant="label" style={styles.subhead}>{t('bp.branches')}</Text>
            {d.branches.map((br) => (
              <Fact key={br.id} label={br.name} value={[br.locality, br.contactName, br.contactLast4 ? `******${br.contactLast4}` : null].filter(Boolean).join(' · ')} />
            ))}
          </>
        ) : null}
      </Card>

      <Card title={t('bp.documents')} icon="clipboard" accent="navy" testID="fa08-documents">
        {d.documentsHidden ? (
          <Text variant="muted">{t('bp.documentsHidden')}</Text>
        ) : anyDoc ? (
          <>
            {DOC_ORDER.map((k) => <Fact key={k} label={t(`fa07.doc.${k}` as MessageKey)} value={docs[k]} testID={`fa08-doc-${k}`} />)}
            <Fact label={t('bp.pan')} value={d.documents.panLast4} />
            {d.documents.others.map((o) => <Fact key={o.kind} label={t(`fa07.doc.${o.kind}` as MessageKey)} value={o.number} testID={`fa08-doc-${o.kind}`} />)}
          </>
        ) : (
          <Text variant="muted">{d.documents.noDocuments ? t('bp.noDocuments') : t('bp.noDocumentsSaved')}</Text>
        )}
      </Card>

      <Card title={t('bp.onboarding')} icon="flag" accent="gold" testID="fa08-joined">
        <Fact label={t('bp.registeredOn')} value={`${formatDayIst(d.onboarding.registeredAt)} ${formatTimeIst(d.onboarding.registeredAt)}`} />
        <Fact label={t('bp.registeredBy')} value={d.onboarding.registeredBy} />
        <Fact label={t('bp.channel')} value={d.onboarding.channel ? t(`bp.channel.${d.onboarding.channel}` as MessageKey) : null} />
        <Fact label={t('bp.heardFrom')} value={d.onboarding.heardFrom ? t(`heard.${d.onboarding.heardFrom}` as MessageKey) : null} />
        <Fact label={t('bp.inPerson')} value={d.onboarding.inPersonAt ? formatDayIst(d.onboarding.inPersonAt) : null} />
        <Fact label={t('bp.verifiedOn')} value={d.onboarding.verifiedAt ? formatDayIst(d.onboarding.verifiedAt) : null} />
      </Card>
    </>
  );
}

/** Board photos and selfies from the agent's own visits (the server signs them per visit). */
function Photos({ visits }: { visits: PageVisit[] }) {
  const { t } = useI18n();
  const withPhotos = visits.filter((v) => v.mine && (v.hasBoardPhoto || v.hasSelfie)).slice(0, 5);
  return (
    <Card title={t('bp.tab.photos')} icon="camera" accent="royal" testID="fa08-photos">
      <Text variant="tiny">{t('bp.photos.note')}</Text>
      {withPhotos.length === 0 ? <EmptyState compact emoji="📷" message={t('bp.photos.none')} /> : null}
      {withPhotos.map((v) => <VisitPhotos key={v.id} visitId={v.id} at={v.at} />)}
    </Card>
  );
}

function VisitPhotos({ visitId, at }: { visitId: string; at: string }) {
  const { t } = useI18n();
  const { redesign } = useEndpoints();
  const q = useQuery({ queryKey: queryKeys.visit(visitId), queryFn: () => redesign.visit(visitId), staleTime: 60_000 });
  const shots = [
    q.data?.boardPhoto ? { url: q.data.boardPhoto.url, label: t('fa05d.boardPhoto') } : null,
    q.data?.selfie ? { url: q.data.selfie.url, label: t('fa05d.selfie') } : null,
  ].filter((s): s is { url: string; label: string } => s !== null);
  return (
    <View style={styles.photoGroup} testID={`fa08-photos-${visitId}`}>
      <Text variant="label">{t('bp.photos.visit', { when: `${formatDayIst(at)} ${formatTimeIst(at)}` })}</Text>
      {q.isPending ? (
        <LoadingState compact />
      ) : shots.length ? (
        <View style={styles.photoRow}>
          {shots.map((s) => (
            <View key={s.label} style={styles.photoCell}>
              <Image source={{ uri: s.url }} style={styles.photo} accessibilityLabel={s.label} resizeMode="cover" />
              <Text variant="tiny">{s.label}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text variant="small">{t('fa05d.photoGone')}</Text>
      )}
    </View>
  );
}

/**
 * The business's history (17 Nov): its visits and its vacancy events
 * (added, sent to the owner, confirmed, filled, closed), newest first.
 */
function History({ b, today }: { b: BusinessPage; today: string }) {
  const { t } = useI18n();
  const sr = useSellingRoutes();
  const entries: HistoryEntry[] = b.history ?? b.visits.map((v) => ({ kind: 'visit' as const, at: v.at, visit: v }));
  const whenOf = (at: string) => (istDateKey(at) === today ? `${t('date.today')} ${formatTimeIst(at)}` : formatDayIst(at));
  return (
    <Card title={t('fa08.history')} icon="clock" accent="gold" testID="fa08-visits">
      {entries.length === 0 ? <EmptyState compact emoji="👟" message={t('fa08.noHistory')} /> : null}
      {entries.map((e, i) => {
        const last = i === entries.length - 1;
        if (e.kind === 'vacancy') {
          const trade = e.headcount > 1 ? `${e.trade} × ${e.headcount}` : e.trade;
          return (
            <ListRow
              key={`${e.vacancyId}-${e.event}-${e.at}`}
              title={t(`history.vacancy.${e.event}` as MessageKey, { trade })}
              subtitle={[whenOf(e.at), e.byName].filter(Boolean).join(' · ')}
              leading={<IconTile icon="briefcase" accent={e.event === 'confirmed' || e.event === 'filled' ? 'green' : e.event === 'closed' ? 'navy' : 'orange'} size={30} />}
              onPress={b.canAct && e.event !== 'filled' && e.event !== 'closed' ? () => router.push(sr.confirmVacancy(e.vacancyId)) : undefined}
              last={last}
              testID={`fa08-history-${e.vacancyId}-${e.event}`}
            />
          );
        }
        const v = e.visit;
        const m = minutesOf(v.durationSeconds);
        const proof = [v.hasBoardPhoto ? '📷' : null, v.hasSelfie ? t('fa05.plusSelfie') : null].filter(Boolean).join(' ');
        return (
          <ListRow
            key={v.id}
            title={[whenOf(v.at), m !== null ? t('common.minutes', { minutes: m }) : null, proof || null].filter(Boolean).join(' · ')}
            subtitle={[t('history.visit'), v.staffName].filter(Boolean).join(' · ')}
            leading={<IconTile icon={v.outcome === 'onboarded' ? 'check-circle' : v.outcome ? 'store' : 'clipboard'} accent={v.outcome === 'onboarded' ? 'green' : v.outcome ? 'cyan' : 'gold'} size={30} />}
            trailing={<StatusChip tone={v.outcome === 'onboarded' ? 'green' : v.outcome === 'already_onboarded' ? 'blue' : v.outcome ? 'cyan' : 'amber'} label={t(outcomeKey(v.outcome))} />}
            // Visit details are for the agent's own visits.
            onPress={v.mine ? () => router.push(pageRoutes.visitDetails(v.id, '/businesses')) : undefined}
            last={last}
            testID={`fa08-visit-${v.id}`}
          />
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  pressed: { opacity: 0.75 },
  heroLines: { gap: 6 },
  heroLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroText: { fontFamily: fonts.body500, fontSize: 13.5, color: colors.white, flexShrink: 1 },
  quick: { flexDirection: 'row', gap: 8 },
  quickBtn: {
    flex: 1,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickOff: { backgroundColor: colors.neutral100 },
  quickText: { fontFamily: fonts.body700, fontSize: 12.5, color: colors.blue },
  steps: { gap: 8 },
  stepRow: { flexDirection: 'row', gap: 8 },
  step: { flex: 1, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 2 },
  stepOk: { backgroundColor: colors.green100, borderColor: colors.border },
  stepWait: { backgroundColor: colors.amber100, borderColor: colors.amberBorder },
  stepWarn: { backgroundColor: colors.crit100, borderColor: colors.border },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepLabel: { fontFamily: fonts.body500, fontSize: 12.5, color: colors.soft, flexShrink: 1 },
  stepValue: { fontFamily: fonts.body700, fontSize: 13.5 },
  stuck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  numbers: { flexDirection: 'row', gap: 8 },
  num: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  numValue: { fontFamily: fonts.display700, fontSize: 20, color: colors.ink },
  numLabel: { fontFamily: fonts.body500, fontSize: 11.5, color: colors.soft },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: { paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.blue, borderColor: colors.blue },
  tabText: { fontFamily: fonts.body700, fontSize: 13, color: colors.blue },
  tabTextOn: { color: colors.white },
  fact: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 1 },
  factLabel: { fontFamily: fonts.body500, fontSize: 12, color: colors.soft },
  factValue: { fontFamily: fonts.body700, fontSize: 14.5, color: colors.ink },
  subhead: { marginTop: 8 },
  photoGroup: { gap: 6, marginTop: 8 },
  photoRow: { flexDirection: 'row', gap: 8 },
  photoCell: { flex: 1, gap: 2 },
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.neutral100 },
});
