import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CountsSheet } from './counts-sheet';

describe('CountsSheet', () => {
  let component: CountsSheet;
  let fixture: ComponentFixture<CountsSheet>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CountsSheet],
    }).compileComponents();

    fixture = TestBed.createComponent(CountsSheet);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
