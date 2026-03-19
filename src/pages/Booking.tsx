import { useState, useRef, useEffect } from 'react';
import emailjs from '@emailjs/browser';
import { Calendar as CalendarIcon, Users, Car, Plane, CheckCircle, X } from 'lucide-react';
import { format } from 'date-fns';
import { Toaster, toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLanguage } from '@/hooks/useLanguage';
import type { Language } from '@/i18n';

const tourTypeData = {
  private: { icon: Users, name: 'Private Tour' },
  group: { icon: Car, name: 'Group Tour' },
  pickup: { icon: Plane, name: 'Airport Pickup' },
};

const languages: { value: Language; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
];

export default function Booking({ onClose }: { onClose?: () => void }) {
  const { language, t, changeLanguage } = useLanguage();
  const form = useRef<HTMLFormElement>(null);
  const [date, setDate] = useState<Date | undefined>();
  const [selectedTourType, setSelectedTourType] = useState<keyof typeof tourTypeData>('private');
  const [numberOfPeople, setNumberOfPeople] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    if (isSubmitted && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, 3000); // Auto close after 3 seconds
      return () => clearTimeout(timer);
    }
  }, [isSubmitted, onClose]);

  const sendEmail = (e: React.FormEvent) => {
    e.preventDefault();

    if (!date) {
      toast.error(t.booking.validation.date);
      return;
    }

    if (form.current) {
      setIsSubmitting(true);
      
      emailjs.init("f8sVlXUDk2UMg3K7W");

      emailjs
        .sendForm(
          "service_cocotripkr",
          "template_fcxgsif",
          form.current
        )
        .then(
          () => {
            setIsSubmitted(true);
          },
          (error: unknown) => {
            toast.error(t.booking.validation.failed);
            console.error('EMAILJS ERROR:', (error as { text?: string }).text || error);
          }
        )
        .finally(() => {
          setIsSubmitting(false);
        });
    }
  };
  
  const handleNewBooking = () => {
    if (form.current) form.current.reset();
    setDate(undefined);
    setNumberOfPeople(1);
    setSelectedTourType('private');
    setIsSubmitted(false);
    if (onClose) onClose();
  }

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
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
          <p className="text-sm text-gray-400 mb-4">Closing automatically...</p>
          <Button onClick={handleNewBooking} className="rounded-xl w-full py-4 text-base bg-[#0f3460] text-white hover:bg-[#1a1a2e] font-bold border border-white/10 transition-colors">
            {t.booking.success.newBooking}
          </Button>
        </div>
      ) : (
        <div className="p-6 sm:p-8 text-white">
          <h1 className="font-bold text-2xl sm:text-3xl mb-2 text-white">{t.booking.title}</h1>
          <p className="mb-6 text-white/70 text-sm">{t.booking.subtitle}</p>

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

          <form ref={form} onSubmit={sendEmail} className="space-y-4 sm:space-y-5 text-sm sm:text-base">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">{t.booking.tourType}</label>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {(Object.keys(tourTypeData) as Array<keyof typeof tourTypeData>).map((key) => {
                  const tour = tourTypeData[key];
                  const Icon = tour.icon;
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setSelectedTourType(key)}
                      className={cn(
                        'flex flex-col items-center p-2 sm:p-3 rounded-xl border transition-all',
                        selectedTourType === key
                          ? 'bg-white border-white text-[#1a1a2e]'
                          : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20 hover:text-white'
                      )}
                    >
                      <Icon className="w-5 h-5 sm:w-6 sm:h-6 mb-1.5" />
                      <span className="text-[10px] sm:text-xs font-semibold leading-tight text-center">{t.booking.tourTypes[key]}</span>
                    </button>
                  );
                })}
              </div>
              <input type="hidden" name="tour_type" value={t.booking.tourTypes[selectedTourType]} />
            </div>

            <div className="flex gap-3 sm:gap-4">
              <div className='flex-1'>
                <label className="block text-sm font-medium text-white/70 mb-2">{t.booking.date}</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        'w-full justify-start text-left font-normal rounded-xl py-4 sm:py-4 px-3 bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white',
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
                <label htmlFor="people" className="block text-sm font-medium text-white/70 mb-2">{t.booking.people}</label>
                <input
                  type="number" id="people" name="number_of_people"
                  value={numberOfPeople}
                  onChange={(e) => setNumberOfPeople(parseInt(e.target.value, 10))}
                  min="1"
                  className="w-full py-3.5 sm:py-3.5 px-3 border border-white/20 bg-white/10 rounded-xl text-white focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none h-[50px] sm:h-[50px]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="location" className="block text-sm font-medium text-white/70 mb-2">{t.booking.location}</label>
              <input 
                type="text" 
                name="location" 
                id="location" 
                required 
                placeholder={t.booking.locationPlaceholder}
                className="w-full py-4 px-3 border border-white/20 bg-white/10 rounded-xl text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-sm sm:text-base" 
              />
            </div>

            <div className="flex gap-3 sm:gap-4">
              <div className="flex-1">
                <label htmlFor="from_name" className="block text-sm font-medium text-white/70 mb-2">{t.booking.form.name}</label>
                <input type="text" name="from_name" id="from_name" placeholder="e.g., Hong Gildong" required className="w-full py-4 px-3 border border-white/20 bg-white/10 rounded-xl text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-sm sm:text-base" />
              </div>
              <div className="flex-1">
                 <label htmlFor="user_email" className="block text-sm font-medium text-white/70 mb-2">{t.booking.form.email}</label>
                <input type="email" name="user_email" id="user_email" placeholder="e.g., email@example.com" required className="w-full py-4 px-3 border border-white/20 bg-white/10 rounded-xl text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-sm sm:text-base" />
              </div>
            </div>
            
            <div>
              <label htmlFor="contact_number" className="block text-sm font-medium text-white/70 mb-2">{t.booking.form.phone}</label>
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
              <label htmlFor="message" className="block text-sm font-medium text-white/70 mb-2">{t.booking.form.notes}</label>
              <textarea
                name="message" id="message" rows={3}
                placeholder={t.booking.form.notesPlaceholder}
                className="w-full py-4 px-3 border border-white/20 bg-white/10 rounded-xl text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-sm sm:text-base resize-none"
              ></textarea>
            </div>

            <Button type="submit" className="w-full py-4 text-base rounded-xl bg-[#0f3460] text-white hover:bg-[#1a1a2e] font-bold transition-colors border border-[#0f3460] hover:border-white/20 mt-2" disabled={isSubmitting}>
              {isSubmitting ? t.booking.buttons.submitting : t.booking.buttons.submit}
            </Button>
          </form>
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
