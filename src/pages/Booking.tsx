import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { Calendar as CalendarIcon, CheckCircle, X } from 'lucide-react';
import { format } from 'date-fns';
import { Toaster, toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/hooks/useLanguage';
import type { Language } from '@/i18n';

import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';

import { db, signInWithGoogle } from '@/lib/firebase';
import { reserveTourSeats } from '@/services/bookingService';
import { useAuth } from '@/hooks/useAuth';
import { trackBeginCheckout, trackPurchase } from '@/lib/analytics';

const languages: { value: Language; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
];

export default function Booking({ onClose }: { onClose?: () => void }) {
  const { language, t, changeLanguage } = useLanguage();
  const { user, loading: authLoading, error: authError } = useAuth();
  const form = useRef<HTMLFormElement>(null);
  const [date, setDate] = useState<Date | undefined>();
  const [toursLoading, setToursLoading] = useState(true);
  const [toursError, setToursError] = useState<string | null>(null);
  const [tours, setTours] = useState<
    Array<{
      id: string;
      title?: string;
      description?: string;
      price?: number;
      totalSeats?: number;
      currentBookings?: number;
    }>
  >([]);
  const [selectedTourId, setSelectedTourId] = useState<string | null>(null);
  const [numberOfPeople, setNumberOfPeople] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const selectedRemainingSeats = useMemo(() => {
    const tour = tours.find((x) => x.id === selectedTourId);
    if (!tour) return 0;
    const total = Number(tour.totalSeats ?? 0);
    const current = Number(tour.currentBookings ?? 0);
    return Math.max(0, total - current);
  }, [tours, selectedTourId]);

  useEffect(() => {
    if (isSubmitted && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, 3000); // Auto close after 3 seconds
      return () => clearTimeout(timer);
    }
  }, [isSubmitted, onClose]);

  useEffect(() => {
    const q = query(collection(db, 'tours'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, unknown>),
        }));
        setTours(list);
        setToursLoading(false);
        setToursError(null);

        if (list.length > 0) {
          if (!selectedTourId || !list.some((x) => x.id === selectedTourId)) {
            setSelectedTourId(list[0].id);
          }
        } else {
          setSelectedTourId(null);
        }
      },
      (err) => {
        setToursError(err.message);
        setToursLoading(false);
      }
    );

    return () => unsub();
  }, [selectedTourId]);

  const handleGoogleLogin = useCallback(async () => {
    setIsSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : (t.booking.error?.googleLoginFailed || 'Google sign-in failed.');
      toast.error(message);
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const handleReserve = async (e: FormEvent) => {
    e.preventDefault();

    if (!date) {
      toast.error(t.booking.validation.date);
      return;
    }

    if (authLoading) {
      toast.error(t.booking.error?.checkingAuthState || 'Checking sign-in status.');
      return;
    }

    if (!user) {
      toast.error(t.booking.error?.requireGoogleLogin || 'Please sign in with Google.');
      return;
    }

    if (!selectedTourId) {
      toast.error(t.booking.error?.selectTour || 'Please select a tour.');
      return;
    }

    if (!form.current) return;

    const fd = new FormData(form.current);
    const tourDate = format(date, 'yyyy-MM-dd');
    const fromName = String(fd.get('from_name') ?? '').trim();
    const customerEmail = String(fd.get('user_email') ?? user.email ?? '').trim();
    const phone = String(fd.get('contact_number') ?? '').trim();
    const location = String(fd.get('location') ?? '').trim();
    const notes = String(fd.get('message') ?? '').trim();

    if (!fromName) {
      toast.error(t.booking.validation?.nameRequired || 'Please enter your name.');
      return;
    }
    if (!customerEmail) {
      toast.error(t.booking.validation?.emailRequired || 'Please enter your email.');
      return;
    }
    if (!phone) {
      toast.error(t.booking.validation?.phoneRequired || 'Please enter your phone.');
      return;
    }
    if (!location) {
      toast.error(t.booking.validation?.locationRequired || 'Please enter location.');
      return;
    }

    // GA4: begin checkout
    const currentTour = tours.find(x => x.id === selectedTourId);
    trackBeginCheckout(
      selectedTourId,
      currentTour?.title ?? 'Unknown Tour',
      numberOfPeople,
      currentTour?.price ?? undefined,
    );

    setIsSubmitting(true);
    try {
      await reserveTourSeats({
        db,
        tourId: selectedTourId,
        partySize: numberOfPeople,
        userId: user.uid,
        tourDate,
        customer: {
          fromName,
          email: customerEmail,
          phone,
          location,
          notes,
        },
      });

      // GA4: successful booking
      const bookedTour = tours.find(x => x.id === selectedTourId);
      trackPurchase(
        selectedTourId,
        bookedTour?.title ?? 'Unknown Tour',
        numberOfPeople,
        bookedTour?.price ?? undefined,
      );

      setIsSubmitted(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : (t.booking.error?.reservationFailed || 'Reservation failed.');
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleNewBooking = () => {
    if (form.current) form.current.reset();
    setDate(undefined);
    setNumberOfPeople(1);
    setSelectedTourId(tours[0]?.id ?? null);
    setIsSubmitted(false);
    if (onClose) onClose();
  }

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  const content = (
    <div className="w-full max-w-lg mx-auto sm:mx-0 max-h-[90vh] overflow-y-auto bg-[#1a1a2e] rounded-2xl shadow-2xl backdrop-blur-md border border-white/10 relative scrollbar-hide">
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors z-10"
        >
          <X className="w-6 h-6" />
        </button>
      )}
      
      {isSubmitted ? (
        <div className="text-center p-8 sm:p-12 text-white">
          <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-6" />
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t.booking.success.title}</h1>
          <p className="text-sm sm:text-base mb-8">{t.booking.success.message}</p>
          <p className="text-sm text-gray-400 mb-4">{t.booking.successAutoClosing || 'Closing automatically...'}</p>
          <Button onClick={handleNewBooking} className="rounded-xl w-full py-4 text-base bg-[#0f3460] text-white hover:bg-[#1a1a2e] font-bold border border-white/10 transition-colors">
            {t.booking.success.newBooking}
          </Button>
        </div>
      ) : (
        <div className="p-8 sm:p-10 text-white">
          <h1 className="font-bold text-2xl sm:text-3xl mb-4 text-white">{t.booking.title}</h1>
          <p className="mb-6 text-white/70 text-sm">{t.booking.subtitle}</p>

          {authLoading ? (
            <div className="mt-6 text-sm text-white/70">{t.booking.loading?.tours || 'Loading...'}</div>
          ) : !user ? (
            <div className="mt-6 space-y-4">
              <h2 className="text-xl font-bold">{t.booking.auth?.heading || 'Sign in to book'}</h2>
              <p className="text-sm text-white/70">
                {t.booking.auth?.subtitle || 'Complete your reservation after signing in.'}
              </p>
              <Button
                onClick={handleGoogleLogin}
                disabled={isSigningIn}
                className="w-full py-4 rounded-xl bg-white text-[#1a1a2e] hover:bg-gray-100 font-bold transition-colors border border-white/10 flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {isSigningIn ? (t.booking.auth?.signingIn || 'Signing in...') : (t.booking.auth?.startGoogle || 'Start with Google')}
              </Button>
              {/* Apple 로그인 임시 비활성화 */}
              {authError ? (
                <p className="text-sm text-red-300">{authError}</p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex space-x-1 bg-white/10 p-1 rounded-xl mb-6">
            {languages.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => changeLanguage(l.value)}
                className={cn(
                  "flex-1 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap",
                  language === l.value
                    ? "bg-white text-[#1a1a2e] shadow font-bold"
                    : "text-white hover:bg-white/20"
                )}
              >
                {l.label}
              </button>
            ))}
          </div>

          <form ref={form} onSubmit={handleReserve} className="space-y-6 text-sm sm:text-base">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-3">{t.booking.tourType}</label>
              {toursLoading ? (
                <p className="text-xs text-white/60">{t.booking.loading?.toursDetail || 'Loading tours...'}</p>
              ) : toursError ? (
                <p className="text-xs text-red-300">{toursError}</p>
              ) : tours.length === 0 ? (
                <p className="text-xs text-white/60">{t.booking.error?.noToursAvailable || 'No tours available.'}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {tours.map((tour) => {
                    const total = Number(tour.totalSeats ?? 0);
                    const current = Number(tour.currentBookings ?? 0);
                    const remaining = Math.max(0, total - current);
                    const isSelected = selectedTourId === tour.id;

                    return (
                      <button
                        key={tour.id}
                        type="button"
                        onClick={() => setSelectedTourId(tour.id)}
                        disabled={remaining <= 0}
                        className={cn(
                          'flex flex-col items-center text-center py-4 px-2 sm:p-4 rounded-xl border transition-all',
                          isSelected
                            ? 'bg-white border-white text-[#1a1a2e]'
                            : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20 hover:text-white',
                          remaining <= 0 ? 'opacity-50 cursor-not-allowed' : ''
                        )}
                      >
                        <div className="text-sm font-semibold leading-tight">
                          {tour.title ?? 'Untitled'}
                        </div>
                        <div className="text-xs opacity-80 mt-2">
                          {t.booking.tour?.priceLabel || 'Price:'} {tour.price != null ? `${tour.price}` : '-'}
                        </div>
                        <div className="text-[10px] opacity-80 mt-1">
                          {t.booking.tour?.seatsLabel || 'Seats:'} {remaining} / {total}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <div className='flex-1'>
                <label className="block text-sm font-medium text-white/70 mb-3">{t.booking.date}</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        'w-full justify-start text-left font-normal rounded-xl py-4 sm:py-4 px-3 bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white h-[50px] sm:h-[50px]',
                        !date && 'text-white/50'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? format(date, 'PPP') : <span className="text-xs sm:text-sm truncate">{t.booking.pickDate}</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 border-white/20 bg-[#1a1a2e] text-white">
                    <Calendar mode="single" selected={date} onSelect={setDate} initialFocus disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))} className="text-white"/>
                  </PopoverContent>
                </Popover>
                <input type="hidden" name="tour_date" value={date ? format(date, 'yyyy-MM-dd') : ''} />
              </div>
               <div className="w-[35%] sm:w-2/5">
                <label htmlFor="people" className="block text-sm font-medium text-white/70 mb-3">{t.booking.people}</label>
                <input
                  type="number" id="people" name="number_of_people"
                  value={numberOfPeople}
                  onChange={(e) => setNumberOfPeople(parseInt(e.target.value, 10))}
                  min="1"
                  className="w-full py-4 px-3 border border-white/20 bg-white/10 rounded-xl text-white focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none h-[50px] sm:h-[50px]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="location" className="block text-sm font-medium text-white/70 mb-3">{t.booking.location}</label>
              <input 
                type="text" 
                name="location" 
                id="location" 
                required 
                placeholder={t.booking.locationPlaceholder}
                className="w-full py-4 px-3 border border-white/20 bg-white/10 rounded-xl text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-sm sm:text-base" 
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label htmlFor="from_name" className="block text-sm font-medium text-white/70 mb-3">{t.booking.form.name}</label>
                <input type="text" name="from_name" id="from_name" placeholder="e.g., Hong Gildong" required className="w-full py-4 px-3 border border-white/20 bg-white/10 rounded-xl text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-sm sm:text-base" />
              </div>
              <div className="flex-1">
                 <label htmlFor="user_email" className="block text-sm font-medium text-white/70 mb-3">{t.booking.form.email}</label>
                <input
                  type="email"
                  name="user_email"
                  id="user_email"
                  placeholder="e.g., email@example.com"
                  defaultValue={user?.email ?? ''}
                  required
                  readOnly
                  className="w-full py-4 px-3 border border-white/20 bg-white/10 rounded-xl text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-sm sm:text-base"
                />
              </div>
            </div>
            
            <div>
              <label htmlFor="contact_number" className="block text-sm font-medium text-white/70 mb-3">{t.booking.form.phone}</label>
              <div className="flex gap-2">
                <input 
                  type="tel" 
                  name="contact_number" 
                  id="contact_number" 
                  placeholder="+82 10-1234-5678"
                  required 
                  className="w-full py-4 px-3 border border-white/20 bg-white/10 rounded-xl text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-sm sm:text-base" 
                />
              </div>
            </div>

            <div>
              <label htmlFor="message" className="block text-sm font-medium text-white/70 mb-3">{t.booking.form.notes}</label>
              <textarea
                name="message" id="message" rows={3}
                placeholder={t.booking.form.notesPlaceholder}
                className="w-full py-4 px-3 border border-white/20 bg-white/10 rounded-xl text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-sm sm:text-base resize-none"
              ></textarea>
            </div>

            <Button
              type="submit"
              className="w-full py-4 text-base rounded-xl bg-[#0f3460] text-white hover:bg-[#1a1a2e] font-bold transition-colors border border-[#0f3460] hover:border-white/20 mt-8"
              disabled={
                isSubmitting ||
                !selectedTourId ||
                toursLoading ||
                tours.length === 0 ||
                selectedRemainingSeats < numberOfPeople
              }
            >
              {isSubmitting ? t.booking.buttons.submitting : t.booking.buttons.submit}
            </Button>
          </form>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div 
      className={cn(
        "flex items-center justify-center p-4 min-h-screen fixed inset-0 z-50",
        onClose ? "bg-black/70 backdrop-blur-sm" : "" // background is handled by wrapper if onClose is undefined
      )}
      onClick={handleOverlayClick}
    >
      <Toaster position="top-center" richColors />
      {content}
    </div>
  );
}
