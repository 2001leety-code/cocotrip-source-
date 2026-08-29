import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { authFetch } from '@/lib/authFetch';
import { naverMapSearchUrl } from '@/lib/naverMap';
import {
  apiErrorMessage,
  copyVehicleQuoteText,
  createVehicleQuoteStop,
  durationHoursFromTimes,
  durationInputToMinutes,
  isVehicleQuoteStopRouteReady,
  moveVehicleQuoteStop,
  normalizeVehicleQuoteStops,
  parseVehicleQuoteManualDistanceInput,
  parseVehicleQuoteProfileNumericInput,
  profileMinutesRange,
  renumberVehicleQuoteStops,
  toVehicleQuotePreviewStops,
  unwrapApiData,
  vehicleQuoteBasisPointsToPercentInput,
  VEHICLE_QUOTE_BILLING_INCREMENTS,
  VEHICLE_QUOTE_MAX_AUTOMATIC_ROUTE_ADDRESSES,
  vehicleQuoteMetersToKilometersInput,
  vehicleQuoteMinutesToHoursInput,
  vehicleQuoteRoutePoints,
  type DistanceBillingMode,
  type EditableVehicleQuoteProfile,
  type QuoteExpensePolicy,
  type VehicleQuoteParseData,
  type VehicleQuotePreviewData,
  type VehicleQuotePreviewRequest,
  type VehicleQuoteProfile,
  type VehicleQuoteStop,
} from '@/lib/vehicleQuote';
import { getMoodQuoteText } from './moodQuoteI18n';

const INPUT = 'min-h-11 w-full rounded-xl border border-violet-300/20 bg-violet-400/[0.06] px-3 py-2.5 text-[15px] leading-5 text-white placeholder:text-white/35 outline-none transition focus-visible:border-violet-300/70 focus-visible:ring-2 focus-visible:ring-violet-400/35';
const BUTTON = 'min-h-11 rounded-xl border px-3 py-2 text-sm font-bold outline-none transition active:translate-y-px focus-visible:ring-2 focus-visible:ring-violet-300/70 disabled:cursor-not-allowed disabled:opacity-45';
const CARD = 'rounded-2xl border border-violet-300/15 bg-[#0f1220]/95 p-3 shadow-[0_12px_36px_rgba(0,0,0,0.22)] sm:p-4';

interface ProfilesResponse {
  profiles: VehicleQuoteProfile[];
  builtInProfileId: string;
}

interface ProfileSaveResponse {
  profile?: VehicleQuoteProfile;
}

interface ProfileForm {
  id: string;
  version?: number;
  companyName: string;
  hourlyRateKRW: string;
  minHours: string;
  maxHours: string;
  billingIncrementMinutes: string;
  distanceThresholdKm: string;
  distanceRateKRWPerKm: string;
  distanceBillingMode: DistanceBillingMode;
  vatPercent: string;
  tollPolicy: QuoteExpensePolicy;
  parkingPolicy: QuoteExpensePolicy;
  overtimeRateKRW: string;
  overtimeIncludesVat: boolean;
  documentTitle: string;
  footer: string;
}

interface PlaceHit {
  name: string;
  roadAddress: string;
  jibunAddress: string;
  lat: number;
  lng: number;
}

interface PlaceSearchState {
  stopId: string;
  query: string;
  busy: boolean;
  searched: boolean;
  items: PlaceHit[];
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

const DEFAULT_PROFILE_FORM: ProfileForm = {
  id: '',
  companyName: '',
  hourlyRateKRW: '30000',
  minHours: '3',
  maxHours: '15',
  billingIncrementMinutes: '1',
  distanceThresholdKm: '50',
  distanceRateKRWPerKm: '600',
  distanceBillingMode: 'all_distance_when_threshold_reached',
  vatPercent: '10',
  tollPolicy: 'route_estimate',
  parkingPolicy: 'manual',
  overtimeRateKRW: '33000',
  overtimeIncludesVat: true,
  documentTitle: '전용 차량 일정 및 예상 견적',
  footer: '',
};

function profileToForm(profile: VehicleQuoteProfile): ProfileForm {
  return {
    id: profile.id,
    version: profile.version,
    companyName: profile.companyName,
    hourlyRateKRW: String(profile.hourlyRateKRW),
    minHours: vehicleQuoteMinutesToHoursInput(profile.minMinutes),
    maxHours: vehicleQuoteMinutesToHoursInput(profile.maxMinutes),
    billingIncrementMinutes: String(profile.billingIncrementMinutes),
    distanceThresholdKm: vehicleQuoteMetersToKilometersInput(profile.distanceThresholdMeters),
    distanceRateKRWPerKm: String(profile.distanceRateKRWPerKm),
    distanceBillingMode: profile.distanceBillingMode,
    vatPercent: vehicleQuoteBasisPointsToPercentInput(profile.vatBasisPoints),
    tollPolicy: profile.tollPolicy,
    parkingPolicy: profile.parkingPolicy,
    overtimeRateKRW: String(profile.overtimeRateKRW),
    overtimeIncludesVat: profile.overtimeIncludesVat,
    documentTitle: profile.documentTitle,
    footer: profile.footer,
  };
}

function parseKRWAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 10_000_000 ? parsed : null;
}

function asManualDistance(value: string): number | null {
  return parseVehicleQuoteManualDistanceInput(value);
}

function formatKRW(value: number): string {
  const safe = Number.isFinite(value) ? Math.round(value) : 0;
  return `${safe.toLocaleString('ko-KR')}원`;
}

function parseResponseStops(data: VehicleQuoteParseData): VehicleQuoteStop[] {
  return normalizeVehicleQuoteStops(data.stops).map((stop) => ({
    ...stop,
    addressVerified: false,
  }));
}

export interface MoodQuoteBuilderProps {
  className?: string;
}

export function MoodQuoteBuilder({ className = '' }: MoodQuoteBuilderProps) {
  const { language } = useLanguage();
  const t = getMoodQuoteText(language);
  const pasteRef = useRef<HTMLTextAreaElement | null>(null);
  const parseRequestGenerationRef = useRef(0);
  const parseAbortControllerRef = useRef<AbortController | null>(null);
  const previewRequestGenerationRef = useRef(0);
  const previewAbortControllerRef = useRef<AbortController | null>(null);

  const [profiles, setProfiles] = useState<VehicleQuoteProfile[]>([]);
  const [builtInProfileId, setBuiltInProfileId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileForm, setProfileForm] = useState<ProfileForm>(DEFAULT_PROFILE_FORM);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);

  const [rawText, setRawText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseNeedsConfirm, setParseNeedsConfirm] = useState(false);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [serviceDate, setServiceDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [durationInput, setDurationInput] = useState('');
  const [departureAddress, setDepartureAddress] = useState('');
  const [returnAddress, setReturnAddress] = useState('');
  const [stops, setStops] = useState<VehicleQuoteStop[]>([]);

  const [routeMode, setRouteMode] = useState<'route' | 'manual'>('route');
  const [manualDistanceKm, setManualDistanceKm] = useState('');
  const [manualTollKRW, setManualTollKRW] = useState('0');
  const [parkingKRW, setParkingKRW] = useState('0');
  const [preview, setPreview] = useState<VehicleQuotePreviewData | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [notice, setNotice] = useState<Notice>(null);
  const [placeSearch, setPlaceSearch] = useState<PlaceSearchState | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) || null,
    [profiles, selectedProfileId],
  );

  const invalidatePreview = useCallback(() => {
    const hadPendingRequest = Boolean(previewAbortControllerRef.current);
    previewRequestGenerationRef.current += 1;
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    setPreviewLoading(false);
    setPreview((current) => {
      if (current || hadPendingRequest) setPreviewStale(true);
      return null;
    });
    setCopyState('idle');
  }, []);

  useEffect(() => () => {
    parseRequestGenerationRef.current += 1;
    parseAbortControllerRef.current?.abort();
    parseAbortControllerRef.current = null;
    previewRequestGenerationRef.current += 1;
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
  }, []);

  const loadProfiles = useCallback(async (preferredProfileId = '') => {
    setProfilesLoading(true);
    try {
      const response = await authFetch('/api/mood-quote-profiles');
      const json: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(json, t.requestFailed));
      const data = unwrapApiData<ProfilesResponse>(json);
      const nextProfiles = Array.isArray(data?.profiles) ? data.profiles : [];
      const defaultId = preferredProfileId
        || data?.builtInProfileId
        || nextProfiles[0]?.id
        || '';
      setProfiles(nextProfiles);
      setBuiltInProfileId(data?.builtInProfileId || '');
      setSelectedProfileId(defaultId);
      const selected = nextProfiles.find((profile) => profile.id === defaultId) || nextProfiles[0];
      if (selected) setProfileForm(profileToForm(selected));
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : t.requestFailed });
    } finally {
      setProfilesLoading(false);
    }
  }, [t.requestFailed]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial authenticated profile hydration
    void loadProfiles();
  }, [loadProfiles]);

  const updateProfileField = <K extends keyof ProfileForm>(field: K, value: ProfileForm[K]) => {
    setProfileForm((current) => ({ ...current, [field]: value }));
    setProfileDirty(true);
    invalidatePreview();
  };

  const handleProfileSelection = (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId);
    setSelectedProfileId(profileId);
    if (profile) setProfileForm(profileToForm(profile));
    setProfileDirty(false);
    setProfileEditorOpen(false);
    setNotice(null);
    invalidatePreview();
  };

  const handleNewProfile = () => {
    const seed = selectedProfile ? profileToForm(selectedProfile) : DEFAULT_PROFILE_FORM;
    setSelectedProfileId('');
    setProfileForm({ ...seed, id: '', version: undefined, companyName: '' });
    setProfileDirty(true);
    setProfileEditorOpen(true);
    setNotice(null);
    invalidatePreview();
  };

  const handleSaveProfile = async () => {
    if (!profileForm.companyName.trim()) {
      setNotice({ kind: 'error', text: t.profileNameRequired });
      return;
    }
    const numericProfile = parseVehicleQuoteProfileNumericInput({
      hourlyRateKRW: profileForm.hourlyRateKRW,
      minHours: profileForm.minHours,
      maxHours: profileForm.maxHours,
      billingIncrementMinutes: profileForm.billingIncrementMinutes,
      distanceThresholdKm: profileForm.distanceThresholdKm,
      distanceRateKRWPerKm: profileForm.distanceRateKRWPerKm,
      vatPercent: profileForm.vatPercent,
      overtimeRateKRW: profileForm.overtimeRateKRW,
    });
    if (!numericProfile) {
      setNotice({ kind: 'error', text: t.invalidProfileNumbers });
      return;
    }
    setProfileSaving(true);
    setNotice(null);
    const profile: EditableVehicleQuoteProfile = {
      ...(profileForm.id ? { id: profileForm.id } : {}),
      companyName: profileForm.companyName.trim(),
      ...numericProfile,
      distanceBillingMode: profileForm.distanceBillingMode,
      tollPolicy: profileForm.tollPolicy,
      parkingPolicy: profileForm.parkingPolicy,
      overtimeIncludesVat: profileForm.overtimeIncludesVat,
      documentTitle: profileForm.documentTitle.trim(),
      footer: profileForm.footer.trim(),
    };
    try {
      const response = await authFetch('/api/mood-quote-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          profile,
          expectedVersion: profileForm.id ? profileForm.version : 0,
        }),
      });
      const json: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(json, t.saveFailed));
      const data = unwrapApiData<ProfileSaveResponse>(json);
      const savedId = data?.profile?.id || profileForm.id;
      await loadProfiles(savedId);
      setProfileDirty(false);
      setProfileEditorOpen(false);
      setNotice({ kind: 'ok', text: t.profileSaved });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : t.saveFailed });
    } finally {
      setProfileSaving(false);
    }
  };

  const autoGrowPaste = () => {
    const element = pasteRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${Math.max(168, element.scrollHeight)}px`;
  };

  const invalidateParsedSchedule = () => {
    parseRequestGenerationRef.current += 1;
    parseAbortControllerRef.current?.abort();
    parseAbortControllerRef.current = null;
    setParsing(false);
    setParseNeedsConfirm(false);
    setParseWarnings([]);
    setServiceDate('');
    setStartTime('');
    setEndTime('');
    setDurationInput('');
    setDepartureAddress('');
    setReturnAddress('');
    setStops([]);
    setPlaceSearch(null);
    setNotice(null);
    invalidatePreview();
  };

  const handleAnalyze = async () => {
    const sourceText = rawText.trim();
    if (sourceText.length < 2) return;
    const requestGeneration = parseRequestGenerationRef.current + 1;
    parseRequestGenerationRef.current = requestGeneration;
    parseAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    parseAbortControllerRef.current = abortController;
    setParsing(true);
    setParseNeedsConfirm(true);
    setParseWarnings([]);
    setServiceDate('');
    setStartTime('');
    setEndTime('');
    setDurationInput('');
    setDepartureAddress('');
    setReturnAddress('');
    setStops([]);
    setPlaceSearch(null);
    setNotice(null);
    invalidatePreview();
    try {
      const response = await authFetch('/api/mood-quote-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sourceText }),
        signal: abortController.signal,
      });
      if (abortController.signal.aborted || requestGeneration !== parseRequestGenerationRef.current) return;
      const json: unknown = await response.json().catch(() => ({}));
      if (abortController.signal.aborted || requestGeneration !== parseRequestGenerationRef.current) return;
      if (!response.ok) throw new Error(apiErrorMessage(json, t.requestFailed));
      const data = unwrapApiData<VehicleQuoteParseData>(json);
      if (!data) throw new Error(t.requestFailed);
      setServiceDate(data.serviceDate || '');
      setStartTime(data.startTime || '');
      setEndTime(data.endTime || '');
      const extractedDuration = durationHoursFromTimes(data.startTime || '', data.endTime || '');
      if (extractedDuration) setDurationInput(extractedDuration);
      setDepartureAddress(data.departureAddress || '');
      setReturnAddress(data.returnAddress || '');
      setStops(parseResponseStops(data));
      setParseNeedsConfirm(true);
      setParseWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setPreviewStale(false);
      invalidatePreview();
    } catch (error) {
      if (abortController.signal.aborted || requestGeneration !== parseRequestGenerationRef.current) return;
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : t.requestFailed });
    } finally {
      if (requestGeneration === parseRequestGenerationRef.current) {
        if (parseAbortControllerRef.current === abortController) {
          parseAbortControllerRef.current = null;
        }
        setParsing(false);
      }
    }
  };

  const updateTripField = (setter: (value: string) => void, value: string) => {
    setter(value);
    invalidatePreview();
  };

  const updateStop = (
    clientId: string,
    patch: Partial<VehicleQuoteStop>,
    resetAddressVerification = false,
  ) => {
    setStops((current) => current.map((stop) => (
      stop.clientId === clientId
        ? { ...stop, ...patch, ...(resetAddressVerification ? { addressVerified: false } : {}) }
        : stop
    )));
    invalidatePreview();
  };

  const addStop = () => {
    setStops((current) => [
      ...current,
      createVehicleQuoteStop({ order: current.length + 1, includeInRoute: true }),
    ]);
    invalidatePreview();
  };

  const removeStop = (clientId: string) => {
    setStops((current) => renumberVehicleQuoteStops(current.filter((stop) => stop.clientId !== clientId)));
    setPlaceSearch((current) => current?.stopId === clientId ? null : current);
    invalidatePreview();
  };

  const moveStop = (index: number, direction: -1 | 1) => {
    setStops((current) => moveVehicleQuoteStop(current, index, index + direction));
    invalidatePreview();
  };

  const openPlaceSearch = (stop: VehicleQuoteStop) => {
    setPlaceSearch({
      stopId: stop.clientId,
      query: stop.name || stop.roadAddress || stop.jibunAddress,
      busy: false,
      searched: false,
      items: [],
    });
  };

  const runPlaceSearch = async () => {
    if (!placeSearch || placeSearch.query.trim().length < 2) return;
    const stopId = placeSearch.stopId;
    const query = placeSearch.query.trim();
    setPlaceSearch((current) => current ? { ...current, busy: true, searched: false, items: [] } : current);
    try {
      const response = await fetch(`/api/place-search?query=${encodeURIComponent(query)}&limit=5&lang=${language}`);
      const json = await response.json().catch(() => ({}));
      const rawItems = Array.isArray(json?.items) ? json.items : [];
      const items: PlaceHit[] = rawItems.map((item: Record<string, unknown>) => ({
        name: String(item.name || ''),
        roadAddress: String(item.roadAddress || ''),
        jibunAddress: String(item.address || ''),
        lat: Number(item.lat),
        lng: Number(item.lng),
      })).filter((item: PlaceHit) => (
        Boolean(item.name || item.roadAddress || item.jibunAddress)
        && Number.isFinite(item.lat)
        && Number.isFinite(item.lng)
      ));
      setPlaceSearch((current) => current?.stopId === stopId
        ? { ...current, busy: false, searched: true, items }
        : current);
    } catch {
      setPlaceSearch((current) => current?.stopId === stopId
        ? { ...current, busy: false, searched: true, items: [] }
        : current);
    }
  };

  const choosePlace = (hit: PlaceHit) => {
    if (!placeSearch) return;
    const query = hit.roadAddress || hit.jibunAddress || hit.name;
    updateStop(placeSearch.stopId, {
      name: hit.name,
      roadAddress: hit.roadAddress,
      jibunAddress: hit.jibunAddress,
      lat: hit.lat,
      lng: hit.lng,
      naverMapUrl: naverMapSearchUrl(query),
      addressVerified: true,
    });
    setPlaceSearch(null);
  };

  const durationMinutes = durationInputToMinutes(durationInput);
  const range = profileMinutesRange(selectedProfile);
  const routeStops = stops.filter((stop) => stop.includeInRoute);
  const routePoints = vehicleQuoteRoutePoints({ departureAddress, stops, returnAddress });
  const automaticRouteWithinLimit = routeMode === 'manual'
    || routePoints.length <= VEHICLE_QUOTE_MAX_AUTOMATIC_ROUTE_ADDRESSES;
  const durationInRange = durationMinutes !== null
    && durationMinutes >= range.min
    && durationMinutes <= range.max;
  const hasEnoughStops = routePoints.length >= 2;
  const addressesReady = routeMode === 'manual'
    || routeStops.every(isVehicleQuoteStopRouteReady);
  const parsedManualDistanceKm = asManualDistance(manualDistanceKm);
  const manualRouteReady = routeMode === 'route' || parsedManualDistanceKm !== null;
  const showManualToll = selectedProfile?.tollPolicy === 'manual'
    || (routeMode === 'manual' && selectedProfile?.tollPolicy === 'route_estimate');
  const showParking = Boolean(selectedProfile && selectedProfile.parkingPolicy !== 'included');
  const parsedManualTollKRW = showManualToll ? parseKRWAmount(manualTollKRW) : 0;
  const parsedParkingKRW = showParking ? parseKRWAmount(parkingKRW) : 0;
  const incidentalAmountsReady = parsedManualTollKRW !== null && parsedParkingKRW !== null;
  const parseConfirmationWarnings = [...new Set(parseWarnings)];
  const canGenerate = Boolean(
    selectedProfile
    && !profileDirty
    && serviceDate
    && startTime
    && endTime
    && durationInRange
    && !parseNeedsConfirm
    && hasEnoughStops
    && addressesReady
    && automaticRouteWithinLimit
    && manualRouteReady
    && incidentalAmountsReady
    && !previewLoading,
  );

  const validationMessages = useMemo(() => {
    const messages: string[] = [];
    if (!selectedProfile || profileDirty) messages.push(t.chooseProfile);
    if (durationMinutes === null) messages.push(t.invalidDuration);
    else if (!durationInRange) messages.push(t.durationRange);
    if (parseNeedsConfirm) messages.push(t.confirmParsedScheduleRequired);
    if (!hasEnoughStops) messages.push(t.needTwoStops);
    if (!addressesReady) messages.push(t.verifyIncludedStops);
    if (!automaticRouteWithinLimit) messages.push(t.automaticRouteLimitExceeded);
    if (!manualRouteReady) messages.push(t.invalidManualDistance);
    return messages;
  }, [addressesReady, automaticRouteWithinLimit, durationInRange, durationMinutes, hasEnoughStops, manualRouteReady, parseNeedsConfirm, profileDirty, selectedProfile, t]);

  const handlePreview = async () => {
    if (!canGenerate || !selectedProfile || durationMinutes === null) return;
    const requestGeneration = previewRequestGenerationRef.current + 1;
    previewRequestGenerationRef.current = requestGeneration;
    previewAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    previewAbortControllerRef.current = abortController;
    setPreviewLoading(true);
    setNotice(null);
    const request: VehicleQuotePreviewRequest = {
      profileId: selectedProfile.id,
      profileVersion: selectedProfile.version,
      serviceDate,
      startTime,
      endTime,
      totalMinutes: durationMinutes,
      routeMode,
      ...(routeMode === 'manual' ? {
        manualDistanceKm: parsedManualDistanceKm as number,
      } : {}),
      ...(showManualToll ? { manualTollKRW: parsedManualTollKRW as number } : {}),
      ...(showParking ? { parkingKRW: parsedParkingKRW as number } : {}),
      stops: toVehicleQuotePreviewStops(stops),
      ...(departureAddress.trim() ? { departureAddress: departureAddress.trim() } : {}),
      ...(returnAddress.trim() ? { returnAddress: returnAddress.trim() } : {}),
    };
    try {
      const response = await authFetch('/api/mood-quote-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: abortController.signal,
      });
      if (abortController.signal.aborted || requestGeneration !== previewRequestGenerationRef.current) return;
      const json: unknown = await response.json().catch(() => ({}));
      if (abortController.signal.aborted || requestGeneration !== previewRequestGenerationRef.current) return;
      if (!response.ok) throw new Error(apiErrorMessage(json, t.previewFailed));
      const data = unwrapApiData<VehicleQuotePreviewData>(json);
      if (!data || !data.breakdown || !data.documentText) throw new Error(t.previewFailed);
      setPreview(data);
      setPreviewStale(false);
      setCopyState('idle');
    } catch (error) {
      if (abortController.signal.aborted || requestGeneration !== previewRequestGenerationRef.current) return;
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : t.previewFailed });
    } finally {
      if (requestGeneration === previewRequestGenerationRef.current) {
        if (previewAbortControllerRef.current === abortController) {
          previewAbortControllerRef.current = null;
        }
        setPreviewLoading(false);
      }
    }
  };

  const handleCopy = async () => {
    const copied = await copyVehicleQuoteText(preview?.documentText || '');
    setCopyState(copied ? 'ok' : 'error');
  };

  const distanceModeOptions: Array<{ value: DistanceBillingMode; label: string }> = [
    { value: 'all_distance_when_threshold_reached', label: t.modeAllAtThreshold },
    { value: 'excess_only', label: t.modeExcessOnly },
    { value: 'always', label: t.modeAlways },
    { value: 'none', label: t.modeNone },
  ];
  const tollPolicyOptions: Array<{ value: QuoteExpensePolicy; label: string }> = [
    { value: 'manual', label: t.policyManual },
    { value: 'route_estimate', label: t.policyRoute },
    { value: 'included', label: t.policyIncluded },
  ];
  const parkingPolicyOptions: Array<{ value: QuoteExpensePolicy; label: string }> = [
    { value: 'manual', label: t.policyManual },
    { value: 'included', label: t.policyIncluded },
  ];
  const billingIncrementOptions = VEHICLE_QUOTE_BILLING_INCREMENTS.map((minutes) => ({
    value: String(minutes),
    label: `${minutes}${t.minutes}`,
  }));

  return (
    <section
      aria-labelledby="mood-vehicle-quote-title"
      className={`w-full space-y-4 pb-28 text-white ${className}`}
      data-testid="mood-vehicle-quote-builder"
    >
      <header className="px-0.5">
        <h2 id="mood-vehicle-quote-title" className="text-xl font-black tracking-tight sm:text-2xl">{t.title}</h2>
        <p className="mt-1 text-sm leading-6 text-white/65">{t.subtitle}</p>
        <p className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] px-3 py-2 text-xs leading-5 text-amber-100/85">{t.adminOnly}</p>
      </header>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-3 py-2.5 text-sm ${notice.kind === 'error' ? 'border-red-300/25 bg-red-400/10 text-red-100' : 'border-emerald-300/25 bg-emerald-400/10 text-emerald-100'}`}
        >
          {notice.text}
        </div>
      )}

      <div className={CARD}>
        <h3 className="text-base font-black">{t.profileSection}</h3>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="block min-w-0 text-xs font-bold text-white/65">
            {t.profileSelect}
            <select
              className={`${INPUT} mt-1`}
              value={selectedProfileId}
              disabled={profilesLoading}
              onChange={(event) => handleProfileSelection(event.target.value)}
            >
              {!selectedProfileId && <option value="">{profilesLoading ? t.loadingProfiles : t.noProfile}</option>}
              {profiles.map((profile) => (
                <option key={`${profile.id}-${profile.version}`} value={profile.id}>
                  {profile.companyName}{profile.id === builtInProfileId ? ` · ${t.builtIn}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={`${BUTTON} self-end border-violet-300/25 bg-violet-400/10 text-violet-100`} onClick={handleNewProfile}>
            + {t.newProfile}
          </button>
        </div>
        <button
          type="button"
          className={`${BUTTON} mt-2 w-full border-white/10 bg-white/[0.04] text-white/80`}
          onClick={() => setProfileEditorOpen((current) => !current)}
          aria-expanded={profileEditorOpen}
        >
          {profileEditorOpen ? t.closeProfile : t.editProfile}
        </button>

        {profileEditorOpen && (
          <div className="mt-3 rounded-xl border border-violet-300/15 bg-black/20 p-3">
            <p className="mb-2 text-[11px] leading-5 text-white/55">{t.rateUnitHint}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <QuoteField label={t.companyName} value={profileForm.companyName} onChange={(value) => updateProfileField('companyName', value)} />
              <QuoteField label={t.documentTitle} value={profileForm.documentTitle} onChange={(value) => updateProfileField('documentTitle', value)} />
              <QuoteField type="number" label={t.hourlyRate} inputMode="numeric" value={profileForm.hourlyRateKRW} onChange={(value) => updateProfileField('hourlyRateKRW', value)} />
              <QuoteField type="number" label={t.overtimeRate} inputMode="numeric" value={profileForm.overtimeRateKRW} onChange={(value) => updateProfileField('overtimeRateKRW', value)} />
              <QuoteField type="number" label={t.minimumMinutes} inputMode="decimal" value={profileForm.minHours} onChange={(value) => updateProfileField('minHours', value)} />
              <QuoteField type="number" label={t.maximumMinutes} inputMode="decimal" value={profileForm.maxHours} onChange={(value) => updateProfileField('maxHours', value)} />
              <QuoteSelect label={t.billingIncrement} value={profileForm.billingIncrementMinutes} options={billingIncrementOptions} onChange={(value) => updateProfileField('billingIncrementMinutes', value)} />
              <QuoteCheckbox label={t.overtimeIncludesVat} checked={profileForm.overtimeIncludesVat} onChange={(checked) => updateProfileField('overtimeIncludesVat', checked)} />
              <p className="text-[11px] leading-5 text-white/45 sm:col-span-2">{t.billingIncrementHint}</p>
              <QuoteField type="number" label={t.distanceThreshold} inputMode="decimal" value={profileForm.distanceThresholdKm} onChange={(value) => updateProfileField('distanceThresholdKm', value)} />
              <QuoteField type="number" label={t.distanceRate} inputMode="numeric" value={profileForm.distanceRateKRWPerKm} onChange={(value) => updateProfileField('distanceRateKRWPerKm', value)} />
              <QuoteSelect label={t.distanceMode} value={profileForm.distanceBillingMode} options={distanceModeOptions} onChange={(value) => updateProfileField('distanceBillingMode', value as DistanceBillingMode)} />
              <QuoteField type="number" label={t.vatRate} inputMode="decimal" value={profileForm.vatPercent} onChange={(value) => updateProfileField('vatPercent', value)} />
              <QuoteSelect label={t.tollPolicy} value={profileForm.tollPolicy} options={tollPolicyOptions} onChange={(value) => updateProfileField('tollPolicy', value as QuoteExpensePolicy)} />
              <QuoteSelect label={t.parkingPolicy} value={profileForm.parkingPolicy} options={parkingPolicyOptions} onChange={(value) => updateProfileField('parkingPolicy', value as QuoteExpensePolicy)} />
            </div>
            <label className="mt-2 block text-xs font-bold text-white/65">
              {t.footer}
              <textarea className={`${INPUT} mt-1 min-h-24 resize-y`} value={profileForm.footer} onChange={(event) => updateProfileField('footer', event.target.value)} />
            </label>
            <button
              type="button"
              className={`${BUTTON} mt-3 w-full border-transparent bg-gradient-to-r from-violet-600 to-pink-500 text-white shadow-lg shadow-violet-950/35`}
              onClick={handleSaveProfile}
              disabled={profileSaving || !profileDirty}
            >
              {profileSaving ? t.savingProfile : t.saveProfile}
            </button>
          </div>
        )}
      </div>

      <div className={CARD}>
        <h3 className="text-base font-black">{t.inputSection}</h3>
        <label className="mt-3 block text-xs font-bold text-white/65">
          {t.pasteLabel}
          <textarea
            ref={pasteRef}
            className={`${INPUT} mt-1 min-h-[168px] resize-none overflow-hidden leading-6`}
            value={rawText}
            placeholder={t.pastePlaceholder}
            onChange={(event) => {
              setRawText(event.target.value);
              invalidateParsedSchedule();
              window.requestAnimationFrame(autoGrowPaste);
            }}
          />
        </label>
        <p className="mt-2 text-xs leading-5 text-white/45">{t.analyzeHint}</p>
        <button
          type="button"
          className={`${BUTTON} mt-3 w-full border-violet-300/30 bg-violet-500/20 text-violet-50`}
          onClick={handleAnalyze}
          disabled={parsing || rawText.trim().length < 2}
        >
          {parsing ? t.analyzing : t.analyze}
        </button>
        {parseNeedsConfirm && (
          <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] p-3 text-sm text-amber-100">
            <p>{t.needsConfirm}</p>
            {parseConfirmationWarnings.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200/15 bg-black/15 px-2.5 py-2 text-xs leading-5 text-amber-50/90">
                <ul className="space-y-0.5">
                  {parseConfirmationWarnings.slice(0, 3).map((warning) => <li key={warning}>• {warning}</li>)}
                </ul>
                {parseConfirmationWarnings.length > 3 && (
                  <p className="mt-1 text-amber-100/70">
                    {t.moreWarnings.replace('{count}', String(parseConfirmationWarnings.length - 3))}
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              className={`${BUTTON} mt-2 w-full border-amber-200/25 bg-amber-200/10 text-amber-50`}
              onClick={() => setParseNeedsConfirm(false)}
            >
              {t.confirmParsedSchedule}
            </button>
          </div>
        )}

        <fieldset className="mt-4">
          <legend className="text-sm font-black text-white/85">{t.tripFields}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <QuoteField type="date" label={t.serviceDate} value={serviceDate} onChange={(value) => updateTripField(setServiceDate, value)} />
            <QuoteField type="number" inputMode="decimal" label={t.durationHours} value={durationInput} onChange={(value) => updateTripField(setDurationInput, value)} />
            <QuoteField type="time" label={t.startTime} value={startTime} onChange={(value) => updateTripField(setStartTime, value)} />
            <QuoteField type="time" label={t.endTime} value={endTime} onChange={(value) => updateTripField(setEndTime, value)} />
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-white/40">{t.durationInputHint}</p>
          <QuoteField className="mt-2" label={t.departureAddress} value={departureAddress} placeholder={t.departureAddressPlaceholder} onChange={(value) => updateTripField(setDepartureAddress, value)} />
          <QuoteField className="mt-2" label={t.returnAddress} value={returnAddress} placeholder={t.returnAddressPlaceholder} onChange={(value) => updateTripField(setReturnAddress, value)} />
        </fieldset>
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-black">{t.stopSection}</h3>
          <button type="button" className={`${BUTTON} shrink-0 border-violet-300/25 bg-violet-400/10 text-violet-100`} onClick={addStop}>
            + {t.addStop}
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {stops.map((stop, index) => {
            const isPickup = index === 0 && !departureAddress.trim();
            const isDestination = index === stops.length - 1 && !returnAddress.trim();
            const role = isPickup ? t.pickup : isDestination ? t.destination : t.waypoint;
            const searchOpen = placeSearch?.stopId === stop.clientId;
            return (
              <article key={stop.clientId} className="rounded-2xl border border-white/10 bg-black/25 p-3" aria-label={`${t.stop} ${index + 1}`}>
                <div className="flex items-center gap-2">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-pink-500 text-sm font-black">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black">{role}</p>
                    <p className={`text-[11px] ${isVehicleQuoteStopRouteReady(stop) ? 'text-emerald-300/80' : 'text-amber-200/85'}`}>
                      {stop.addressVerified ? t.addressVerified : t.verificationReset}
                    </p>
                  </div>
                  <button type="button" className={`${BUTTON} min-w-11 border-white/10 bg-white/[0.04] px-2`} onClick={() => moveStop(index, -1)} disabled={index === 0} aria-label={`${stop.name || `${t.stop} ${index + 1}`} ${t.moveUp}`}>↑</button>
                  <button type="button" className={`${BUTTON} min-w-11 border-white/10 bg-white/[0.04] px-2`} onClick={() => moveStop(index, 1)} disabled={index === stops.length - 1} aria-label={`${stop.name || `${t.stop} ${index + 1}`} ${t.moveDown}`}>↓</button>
                  <button type="button" className={`${BUTTON} min-w-11 border-red-300/15 bg-red-400/10 px-2 text-red-200`} onClick={() => removeStop(stop.clientId)} aria-label={`${stop.name || `${t.stop} ${index + 1}`} ${t.remove}`}>×</button>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <QuoteField label={t.placeName} value={stop.name} onChange={(value) => updateStop(stop.clientId, { name: value })} />
                  <QuoteField label={t.purpose} value={stop.purpose} onChange={(value) => updateStop(stop.clientId, { purpose: value })} />
                  <QuoteField type="time" label={t.arrivalTime} value={stop.arrivalTime} onChange={(value) => updateStop(stop.clientId, { arrivalTime: value })} />
                  <QuoteField type="time" label={t.departureTime} value={stop.departureTime} onChange={(value) => updateStop(stop.clientId, { departureTime: value })} />
                  <QuoteField label={t.roadAddress} value={stop.roadAddress} onChange={(value) => updateStop(stop.clientId, { roadAddress: value }, true)} />
                  <QuoteField label={t.jibunAddress} value={stop.jibunAddress} onChange={(value) => updateStop(stop.clientId, { jibunAddress: value }, true)} />
                </div>
                <QuoteField className="mt-2" label={t.mapLink} value={stop.naverMapUrl} onChange={(value) => updateStop(stop.clientId, { naverMapUrl: value })} />

                <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-3">
                  <QuoteCheckbox label={t.optionalSchedule} checked={stop.optional} onChange={(checked) => updateStop(stop.clientId, { optional: checked })} />
                  <QuoteCheckbox label={t.includeInRoute} checked={stop.includeInRoute} onChange={(checked) => updateStop(stop.clientId, { includeInRoute: checked })} />
                  <QuoteCheckbox
                    label={t.addressVerified}
                    checked={stop.addressVerified}
                    disabled={!(stop.roadAddress.trim() || stop.jibunAddress.trim())}
                    onChange={(checked) => updateStop(stop.clientId, { addressVerified: checked })}
                  />
                </div>

                <button type="button" className={`${BUTTON} mt-2 w-full border-sky-300/20 bg-sky-400/10 text-sky-100`} onClick={() => searchOpen ? setPlaceSearch(null) : openPlaceSearch(stop)}>
                  {searchOpen ? t.closeSearch : `⌕ ${t.searchPlace}`}
                </button>
                {searchOpen && placeSearch && (
                  <div className="mt-2 rounded-xl border border-sky-300/15 bg-sky-400/[0.05] p-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <label className="sr-only" htmlFor={`place-search-${stop.clientId}`}>{t.searchPlaceholder}</label>
                      <input
                        id={`place-search-${stop.clientId}`}
                        className={INPUT}
                        value={placeSearch.query}
                        placeholder={t.searchPlaceholder}
                        onChange={(event) => setPlaceSearch({ ...placeSearch, query: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void runPlaceSearch();
                          }
                        }}
                      />
                      <button type="button" className={`${BUTTON} border-sky-300/20 bg-sky-400/15 text-sky-100`} onClick={runPlaceSearch} disabled={placeSearch.busy || placeSearch.query.trim().length < 2}>
                        {placeSearch.busy ? t.searching : t.search}
                      </button>
                    </div>
                    {placeSearch.searched && !placeSearch.items.length && <p className="px-1 py-3 text-sm text-white/55">{t.searchNoResults}</p>}
                    {placeSearch.items.map((item, itemIndex) => (
                      <button
                        type="button"
                        key={`${item.name}-${item.roadAddress}-${itemIndex}`}
                        className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-left outline-none transition hover:border-sky-300/30 focus-visible:ring-2 focus-visible:ring-sky-300/60"
                        onClick={() => choosePlace(item)}
                        aria-label={`${item.name} ${t.usePlace}`}
                      >
                        <span className="block text-sm font-bold text-white">{item.name || t.usePlace}</span>
                        {item.roadAddress && <span className="mt-0.5 block text-xs leading-5 text-white/65">{item.roadAddress}</span>}
                        {item.jibunAddress && <span className="block text-[11px] leading-5 text-white/45">{item.jibunAddress}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <div className={CARD}>
        <h3 className="text-base font-black">{t.quoteSection}</h3>
        <fieldset className="mt-3">
          <legend className="text-xs font-bold text-white/65">{t.routeMode}</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <QuoteRadio label={t.routeAutomatic} checked={routeMode === 'route'} onChange={() => { setRouteMode('route'); invalidatePreview(); }} />
            <QuoteRadio label={t.routeManual} checked={routeMode === 'manual'} onChange={() => { setRouteMode('manual'); invalidatePreview(); }} />
          </div>
          <p className="mt-2 text-[11px] leading-5 text-white/45">{t.automaticRouteLimit}</p>
        </fieldset>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {routeMode === 'manual' && (
            <QuoteField className={!showManualToll && !showParking ? 'col-span-2' : ''} type="number" inputMode="decimal" label={t.manualDistance} value={manualDistanceKm} onChange={(value) => updateTripField(setManualDistanceKm, value)} />
          )}
          {showManualToll && (
            <QuoteField className={routeMode === 'route' && !showParking ? 'col-span-2' : ''} type="number" inputMode="numeric" label={t.manualToll} value={manualTollKRW} onChange={(value) => updateTripField(setManualTollKRW, value)} />
          )}
          {showParking && (
            <QuoteField className={routeMode === 'route' && !showManualToll ? 'col-span-2' : ''} type="number" inputMode="numeric" label={t.parking} value={parkingKRW} onChange={(value) => updateTripField(setParkingKRW, value)} />
          )}
        </div>
        {(showManualToll || showParking) && (
          <p className="mt-1.5 text-[11px] leading-5 text-white/45">{t.incidentalAmountHint}</p>
        )}
        {!incidentalAmountsReady && (
          <p role="alert" className="mt-2 rounded-xl border border-red-300/20 bg-red-400/[0.07] px-3 py-2 text-xs leading-5 text-red-100">
            {t.invalidIncidentalAmounts}
          </p>
        )}

        {validationMessages.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-xl border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-xs leading-5 text-amber-100/85">
            {validationMessages.map((message) => <li key={message}>• {message}</li>)}
          </ul>
        )}
        {previewStale && <p role="status" className="mt-3 text-sm text-amber-200">{t.previewNeedsRefresh}</p>}
        <button
          type="button"
          className={`${BUTTON} mt-3 w-full border-transparent bg-gradient-to-r from-violet-600 to-pink-500 text-base text-white shadow-lg shadow-violet-950/40`}
          onClick={handlePreview}
          disabled={!canGenerate}
        >
          {previewLoading ? t.generatingPreview : t.generatePreview}
        </button>
      </div>

      {preview && (
        <div className={CARD} data-testid="mood-vehicle-quote-preview">
          <h3 className="text-base font-black">{t.previewSection}</h3>
          <p className="mt-1 text-xs leading-5 text-white/45">{t.exactServerCopy}</p>
          <div className="mt-3 rounded-2xl border border-violet-300/20 bg-gradient-to-br from-violet-500/10 to-pink-500/[0.06] p-3">
            <div className="flex items-end justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <p className="text-xs font-bold text-white/50">{t.routeSummary}</p>
                <p className="mt-1 text-sm text-white/80">{t.distance} {preview.route.distanceKm}km · {t.drivingTime} {preview.route.durationMinutes === null ? '—' : `${preview.route.durationMinutes}${t.minutes}`}</p>
              </div>
              <p className="shrink-0 text-right text-xl font-black text-pink-200">{formatKRW(preview.breakdown.totalKRW)}</p>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <BreakdownRow label={t.timeFee} value={formatKRW(preview.breakdown.timeFeeKRW)} />
              <BreakdownRow label={t.distanceFee} value={formatKRW(preview.breakdown.distanceFeeKRW)} />
              <BreakdownRow label={t.supplyAmount} value={formatKRW(preview.breakdown.taxableSupplyKRW)} />
              <BreakdownRow label={t.vat} value={formatKRW(preview.breakdown.vatKRW)} />
              <BreakdownRow label={t.toll} value={preview.profile.tollPolicy === 'included' ? t.policyIncluded : formatKRW(preview.breakdown.tollKRW)} />
              <BreakdownRow label={t.parkingFee} value={preview.profile.parkingPolicy === 'included' ? t.policyIncluded : formatKRW(preview.breakdown.parkingKRW)} />
              <BreakdownRow label={t.overtime} value={formatKRW(preview.breakdown.overtimeRateKRW)} />
              <BreakdownRow label={t.total} value={formatKRW(preview.breakdown.totalKRW)} strong />
            </dl>
          </div>

          {(parseWarnings.length > 0 || preview.warnings.length > 0) && (
            <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2.5">
              <p className="text-sm font-black text-amber-100">{t.warningTitle}</p>
              <ul className="mt-1 space-y-1 text-xs leading-5 text-amber-50/80">
                {[...new Set([...parseWarnings, ...preview.warnings])].map((warning) => <li key={warning}>• {warning}</li>)}
              </ul>
            </div>
          )}

          <pre
            data-mood-quote-print-document
            className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/35 p-3 font-sans text-[14px] leading-6 text-white/85"
          >
            {preview.documentText}
          </pre>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <button type="button" className={`${BUTTON} border-transparent bg-gradient-to-r from-violet-600 to-pink-500 text-white`} onClick={handleCopy}>
              {t.copyDocument}
            </button>
            <button type="button" className={`${BUTTON} border-white/15 bg-white/[0.05] text-white/80`} onClick={() => window.print()}>
              {t.print}
            </button>
          </div>
          {copyState !== 'idle' && <p role="status" className={`mt-2 text-center text-sm ${copyState === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>{copyState === 'ok' ? t.copied : t.copyFailed}</p>}
        </div>
      )}
    </section>
  );
}

interface QuoteFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number' | 'date' | 'time';
  inputMode?: 'text' | 'numeric' | 'decimal';
  placeholder?: string;
  className?: string;
}

function QuoteField({ label, value, onChange, type = 'text', inputMode = 'text', placeholder = '', className = '' }: QuoteFieldProps) {
  return (
    <label className={`block min-w-0 text-xs font-bold text-white/65 ${className}`}>
      {label}
      <input
        className={`${INPUT} mt-1`}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        step={type === 'number' ? 'any' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function QuoteSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className="block min-w-0 text-xs font-bold text-white/65">
      {label}
      <select className={`${INPUT} mt-1`} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function QuoteCheckbox({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-white/70 outline-none focus-within:ring-2 focus-within:ring-violet-300/60 ${disabled ? 'cursor-not-allowed opacity-45' : ''}`}>
      <input type="checkbox" className="size-4 accent-violet-500" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function QuoteRadio({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold outline-none focus-within:ring-2 focus-within:ring-violet-300/60 ${checked ? 'border-violet-300/45 bg-violet-500/20 text-white' : 'border-white/10 bg-white/[0.03] text-white/60'}`}>
      <input type="radio" name="mood-vehicle-quote-route-mode" className="size-4 accent-violet-500" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function BreakdownRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-white/45">{label}</dt>
      <dd className={`mt-0.5 break-words ${strong ? 'font-black text-pink-200' : 'font-bold text-white/85'}`}>{value}</dd>
    </div>
  );
}
