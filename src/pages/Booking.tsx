import { useState, useRef } from 'react';
import emailjs from '@emailjs/browser';
import { Calendar as CalendarIcon, Users, Car, Plane, MapPin, ChevronDown, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Toaster, toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const tourTypes = [
  { name: 'Private Tour', icon: Users },
  { name: 'Group Tour', icon: Car },
  { name: 'Package Tour', icon: Plane },
];

const locations = ['Seoul', 'Busan', 'Jeju', 'Gyeongju', 'Other'];

export default function Booking() {
  const form = useRef<HTMLFormElement>(null);
  const [date, setDate] = useState<Date | undefined>();
  const [selectedTourType, setSelectedTourType] = useState(tourTypes[0]);
  const [selectedLocation, setSelectedLocation] = useState(locations[0]);
  const [numberOfPeople, setNumberOfPeople] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const sendEmail = (e: React.FormEvent) => {
    e.preventDefault();

    if (!date) {
      toast.error('Please select a date for your tour.');
      return;
    }

    if (form.current) {
      setIsSubmitting(true);
      emailjs
        .sendForm(
          import.meta.env.VITE_EMAILJS_SERVICE_ID,
          import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
          form.current,
          'YOUR_PUBLIC_KEY' // Replace with your EmailJS public key
        )
        .then(
          () => {
            toast.success('Booking request sent successfully!');
            setIsSubmitted(true);
            if (form.current) form.current.reset();
            setDate(undefined);
          },
          (error) => {
            toast.error('Failed to send booking request. Please try again.');
            console.error('EMAILJS ERROR:', error.text);
          }
        )
        .finally(() => {
          setIsSubmitting(false);
        });
    }
  };

  if (isSubmitted) {
    return (
      <div className="bg-gray-50 flex flex-col items-center justify-center min-h-screen p-4">
        <div className="text-center bg-white p-12 rounded-2xl shadow-lg">
          <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Thank You!</h1>
          <p className="text-gray-600 mb-8">Your booking request has been received. We will contact you shortly.</p>
          <Button onClick={() => setIsSubmitted(false)}>Make Another Booking</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen flex items-center justify-center p-4">
      <Toaster position="top-center" richColors />
      <div className="max-w-4xl w-full bg-white rounded-2xl shadow-lg overflow-hidden md:flex">
        {/* Left Side - Image & Info */}
        <div className="md:w-1/2 bg-cover bg-center p-8 text-white" style={{ backgroundImage: "url('/hero-seoul-real.jpg')" }}>
          <h1 className="font-bold text-4xl mb-4 drop-shadow-md">Plan Your Trip</h1>
          <p className="mb-8 opacity-90 drop-shadow-sm">
            Fill out the form to request a booking. We'll get back to you with a confirmation and details.
          </p>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 opacity-80" />
              <span>Customized private tours</span>
            </div>
            <div className="flex items-center gap-3">
              <Car className="w-5 h-5 opacity-80" />
              <span>Comfortable transportation</span>
            </div>
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 opacity-80" />
              <span>Experienced local guides</span>
            </div>
          </div>
        </div>

        {/* Right Side - Form */}
        <div className="md:w-1/2 p-8">
          <form ref={form} onSubmit={sendEmail} className="space-y-6">
            {/* Tour Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tour Type</label>
              <div className="grid grid-cols-3 gap-2">
                {tourTypes.map((tour) => (
                  <button
                    type="button"
                    key={tour.name}
                    onClick={() => setSelectedTourType(tour)}
                    className={cn(
                      'flex flex-col items-center p-3 rounded-lg border-2 transition-all',
                      selectedTourType.name === tour.name
                        ? 'bg-blue-50 border-blue-500 text-blue-600'
                        : 'bg-gray-50 hover:bg-gray-100'
                    )}
                  >
                    <tour.icon className="w-6 h-6 mb-1.5" />
                    <span className="text-xs font-semibold">{tour.name}</span>
                  </button>
                ))}
              </div>
              <input type="hidden" name="tour_type" value={selectedTourType.name} />
            </div>

            {/* Date Picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !date && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    initialFocus
                    disabled={(date) => date < new Date() || date < new Date("1900-01-01")}
                  />
                </PopoverContent>
              </Popover>
               <input type="hidden" name="tour_date" value={date ? format(date, 'yyyy-MM-dd') : ''} />
            </div>

            <div className="flex gap-4">
              {/* Number of People */}
              <div className="flex-1">
                <label htmlFor="people" className="block text-sm font-medium text-gray-700 mb-2">Number of People</label>
                <div className="relative">
                  <input
                    type="number"
                    id="people"
                    name="number_of_people"
                    value={numberOfPeople}
                    onChange={(e) => setNumberOfPeople(parseInt(e.target.value, 10))}
                    min="1"
                    className="w-full p-3 border rounded-lg appearance-none"
                  />
                </div>
              </div>

              {/* Location */}
              <div className="flex-1">
                <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                <div className="relative">
                  <select
                    id="location"
                    name="location"
                    value={selectedLocation}
                    onChange={(e) => setSelectedLocation(e.target.value)}
                     className="w-full p-3 border rounded-lg appearance-none bg-white"
                  >
                    {locations.map((loc) => <option key={loc}>{loc}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Name & Email */}
            <div className="flex gap-4">
                <div className="flex-1">
                    <label htmlFor="user_name" className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                    <input type="text" name="user_name" id="user_name" required className="w-full p-3 border rounded-lg" />
                </div>
                <div className="flex-1">
                    <label htmlFor="user_email" className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                    <input type="email" name="user_email" id="user_email" required className="w-full p-3 border rounded-lg" />
                </div>
            </div>

            {/* Message */}
            <div>
              <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">Additional Requests</label>
              <textarea
                name="message"
                id="message"
                rows={4}
                placeholder="Tell us about your travel plans, interests, or any special requirements."
                className="w-full p-3 border rounded-lg"
              ></textarea>
            </div>

            {/* Submit Button */}
            <Button type="submit" className="w-full text-lg py-6" disabled={isSubmitting}>
              {isSubmitting ? 'Sending Request...' : 'Request a Booking'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
